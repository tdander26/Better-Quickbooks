// Reports — Profit & Loss, Balance Sheet, and Cash Flow, rendered as clean,
// friendly financial statements. A Server Component: figures are computed on the
// server (reports lib + prisma) and handed to small sync render helpers. The
// range + tab + export controls live in a sibling client component.
import type { ReactNode } from "react";
import { parseISO, endOfDay, startOfYear, format } from "date-fns";
import { clsx } from "clsx";
import { Landmark, CreditCard, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  profitAndLoss,
  balanceSheet,
  cashFlow,
  type AccountBalance,
  type ProfitAndLoss,
  type BalanceSheet,
} from "@/lib/reports";
import { formatMoney } from "@/lib/money";
import { PageHeader, Card, StatTile, Money, EmptyState } from "@/components/ui";
import { ReportControls } from "./_controls";

// Financial data is per-request and depends on searchParams; never cache.
export const dynamic = "force-dynamic";

type Tab = "pl" | "balance" | "cashflow";

// Sentinel start for the "All time" preset (kept in sync with _controls.tsx).
const ALL_TIME_START = "2000-01-01";

/**
 * Resolve the reporting window from URL params. Defaults to year-to-date
 * (start of this year → now). `start` anchors at the day's start; `end` is made
 * inclusive by snapping to the end of that day.
 */
function resolveRange(sp: Record<string, string | undefined>) {
  const now = new Date();
  let start = startOfYear(now);
  let end = now;
  if (sp.start) {
    const p = parseISO(sp.start);
    if (!isNaN(p.getTime())) start = p;
  }
  if (sp.end) {
    const p = parseISO(sp.end);
    if (!isNaN(p.getTime())) end = endOfDay(p);
  }
  return { start, end };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "balance" || sp.tab === "cashflow" ? sp.tab : "pl";

  const { start, end } = resolveRange(sp);
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");

  const isAllTime = startStr === ALL_TIME_START;
  const rangeLabel = isAllTime
    ? `All time · through ${format(end, "MMM d, yyyy")}`
    : `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;

  // Only the active tab's data is fetched (short-circuits before the await).
  let content: ReactNode;
  if (tab === "balance") {
    content = <BalanceReport data={await balanceSheet()} />;
  } else if (tab === "cashflow") {
    content = <CashFlowReport data={await cashFlow(start, end)} rangeLabel={rangeLabel} />;
  } else {
    content = <PLReport data={await profitAndLoss(start, end)} rangeLabel={rangeLabel} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Profit & loss, balance sheet, and cash flow" />
      <ReportControls tab={tab} start={startStr} end={endStr} />
      {content}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Statements                                                          */
/* ------------------------------------------------------------------ */

function PLReport({ data, rangeLabel }: { data: ProfitAndLoss; rangeLabel: string }) {
  if (!data.income.length && !data.expenses.length) {
    return (
      <EmptyState
        title="No activity in this range"
        hint="No income or expenses were found for these dates. Try a wider range like YTD or All time."
      />
    );
  }
  const inc = data.totalIncomeCents;
  const exp = data.totalExpenseCents;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Income" value={formatMoney(inc, { showCents: false })} tone="green" sub="Money earned" />
        <StatTile label="Expenses" value={formatMoney(exp, { showCents: false })} tone="red" sub="Money spent" />
        <div className="col-span-2 md:col-span-1">
          <StatTile
            label="Net income"
            value={formatMoney(data.netIncomeCents, { showCents: false, signed: true })}
            tone={data.netIncomeCents >= 0 ? "green" : "red"}
            sub="Income − expenses"
          />
        </div>
      </div>

      <StatementCard title="Profit & Loss" meta={rangeLabel}>
        <Section title="Income">
          {data.income.length ? (
            data.income.map((l) => (
              <StatementLine
                key={l.categoryId ?? `inc-${l.category}`}
                label={l.category}
                cents={l.amountCents}
                share={inc ? l.amountCents / inc : 0}
                tone="green"
              />
            ))
          ) : (
            <EmptyRow label="No income in this period" />
          )}
          <SubtotalLine label="Total income" cents={inc} />
        </Section>

        <Section title="Expenses">
          {data.expenses.length ? (
            data.expenses.map((l) => (
              <StatementLine
                key={l.categoryId ?? `exp-${l.category}`}
                label={l.category}
                cents={l.amountCents}
                share={exp ? l.amountCents / exp : 0}
                tone="red"
              />
            ))
          ) : (
            <EmptyRow label="No expenses in this period" />
          )}
          <SubtotalLine label="Total expenses" cents={exp} />
        </Section>

        <NetLine label="Net income" hint="Income − expenses" cents={data.netIncomeCents} />
      </StatementCard>
    </div>
  );
}

function CashFlowReport({
  data,
  rangeLabel,
}: {
  data: Awaited<ReturnType<typeof cashFlow>>;
  rangeLabel: string;
}) {
  const totalIn = data.inflows.reduce((n, l) => n + l.amountCents, 0);
  const totalOut = data.outflows.reduce((n, l) => n + l.amountCents, 0);

  if (!data.inflows.length && !data.outflows.length) {
    return (
      <EmptyState
        title="No cash flow in this range"
        hint="No money moved in or out during these dates. Try a wider range like YTD or All time."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Money in" value={formatMoney(totalIn, { showCents: false })} tone="green" sub="Inflows" />
        <StatTile label="Money out" value={formatMoney(totalOut, { showCents: false })} tone="red" sub="Outflows" />
        <div className="col-span-2 md:col-span-1">
          <StatTile
            label="Net change"
            value={formatMoney(data.netCents, { showCents: false, signed: true })}
            tone={data.netCents >= 0 ? "green" : "red"}
            sub="In − out"
          />
        </div>
      </div>

      <StatementCard title="Cash Flow" meta={rangeLabel}>
        <Section title="Money in">
          {data.inflows.length ? (
            data.inflows.map((l) => (
              <StatementLine
                key={l.categoryId ?? `in-${l.category}`}
                label={l.category}
                cents={l.amountCents}
                share={totalIn ? l.amountCents / totalIn : 0}
                tone="green"
              />
            ))
          ) : (
            <EmptyRow label="No money in during this period" />
          )}
          <SubtotalLine label="Total in" cents={totalIn} />
        </Section>

        <Section title="Money out">
          {data.outflows.length ? (
            data.outflows.map((l) => (
              <StatementLine
                key={l.categoryId ?? `out-${l.category}`}
                label={l.category}
                cents={l.amountCents}
                share={totalOut ? l.amountCents / totalOut : 0}
                tone="red"
              />
            ))
          ) : (
            <EmptyRow label="No money out during this period" />
          )}
          <SubtotalLine label="Total out" cents={totalOut} />
        </Section>

        <NetLine label="Net change" hint="Money in − money out" cents={data.netCents} />
      </StatementCard>
    </div>
  );
}

function BalanceReport({ data }: { data: BalanceSheet }) {
  if (data.assets.length + data.liabilities.length === 0) {
    return (
      <EmptyState
        title="No accounts yet"
        hint="Add a checking account or credit card to see your balance sheet."
      />
    );
  }
  const asOf = format(data.asOf, "MMMM d, yyyy");
  const balanced = data.totalAssetsCents === data.totalLiabilitiesCents + data.equityCents;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Total assets" value={formatMoney(data.totalAssetsCents, { showCents: false })} sub="What you own" />
        <StatTile
          label="Total liabilities"
          value={formatMoney(data.totalLiabilitiesCents, { showCents: false })}
          tone="red"
          sub="What you owe"
        />
        <div className="col-span-2 md:col-span-1">
          <StatTile
            label="Net worth"
            value={formatMoney(data.equityCents, { showCents: false, signed: true })}
            tone={data.equityCents >= 0 ? "green" : "red"}
            sub="Assets − liabilities"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatementCard title="Assets" meta={`As of ${asOf}`}>
          {data.assets.length ? (
            data.assets.map((a) => <AccountLine key={a.id} b={a} cents={a.computedCents} />)
          ) : (
            <EmptyRow label="No asset accounts" />
          )}
          <SubtotalLine label="Total assets" cents={data.totalAssetsCents} />
        </StatementCard>

        <StatementCard title="Liabilities & Equity" meta={`As of ${asOf}`}>
          <Section title="Liabilities">
            {data.liabilities.length ? (
              data.liabilities.map((a) => <AccountLine key={a.id} b={a} cents={-a.computedCents} />)
            ) : (
              <EmptyRow label="No liabilities" />
            )}
            <SubtotalLine label="Total liabilities" cents={data.totalLiabilitiesCents} />
          </Section>
          <Section title="Equity">
            <StatementLine label="Owner's equity" cents={data.equityCents} />
            <SubtotalLine
              label="Total liabilities & equity"
              cents={data.totalLiabilitiesCents + data.equityCents}
            />
          </Section>
        </StatementCard>
      </div>

      <BalanceCheck
        balanced={balanced}
        assets={data.totalAssetsCents}
        liabilities={data.totalLiabilitiesCents}
        equity={data.equityCents}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Statement building blocks (local, sync)                            */
/* ------------------------------------------------------------------ */

function StatementCard({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div
        className="mb-3 flex items-end justify-between gap-3 border-b pb-3"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {meta && <span className="muted text-right text-xs">{meta}</span>}
      </div>
      {children}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="muted mb-1.5 text-xs font-semibold uppercase tracking-wide">{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function StatementLine({
  label,
  cents,
  share,
  tone,
}: {
  label: string;
  cents: number;
  share?: number;
  tone?: "green" | "red";
}) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 truncate text-sm">{label}</span>
        <Money cents={cents} plain className="shrink-0 text-sm" />
      </div>
      {share !== undefined && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
          <div
            className={clsx("h-full rounded-full", tone === "red" ? "bg-rose-400/70" : "bg-emerald-400/70")}
            style={{ width: `${Math.max(3, Math.min(100, Math.round((share || 0) * 100)))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SubtotalLine({ label, cents }: { label: string; cents: number }) {
  return (
    <div
      className="mt-1 flex items-baseline justify-between gap-4 border-t pt-2.5 text-sm font-semibold"
      style={{ borderColor: "var(--border)" }}
    >
      <span>{label}</span>
      <Money cents={cents} plain />
    </div>
  );
}

function NetLine({ label, hint, cents }: { label: string; hint?: string; cents: number }) {
  const positive = cents >= 0;
  return (
    <div
      className={clsx(
        "mt-4 flex items-center justify-between gap-4 rounded-2xl px-4 py-3 ring-1 ring-inset",
        positive ? "bg-emerald-500/5 ring-emerald-500/15" : "bg-rose-500/5 ring-rose-500/15"
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="muted text-xs">{hint}</div>}
      </div>
      <Money cents={cents} className="shrink-0 text-lg font-bold" />
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <div className="muted py-2 text-sm">{label}</div>;
}

function AccountLine({ b, cents }: { b: AccountBalance; cents: number }) {
  const Icon = b.type === "credit_card" ? CreditCard : Landmark;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10">
        <Icon size={15} className="muted" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{b.name}</div>
        <div className="muted truncate text-xs">{b.institution}</div>
      </div>
      <Money cents={cents} plain className="shrink-0 text-sm" />
    </div>
  );
}

function BalanceCheck({
  balanced,
  assets,
  liabilities,
  equity,
}: {
  balanced: boolean;
  assets: number;
  liabilities: number;
  equity: number;
}) {
  return (
    <Card
      className={clsx(
        "flex items-center gap-3 p-4 ring-1 ring-inset",
        balanced ? "ring-emerald-500/20" : "ring-amber-500/20"
      )}
    >
      <span
        className={clsx(
          "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
          balanced
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        )}
      >
        {balanced ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{balanced ? "The books balance" : "Out of balance"}</div>
        <div className="muted mt-0.5 text-xs tabular-nums">
          Assets {formatMoney(assets, { showCents: false })} = Liabilities{" "}
          {formatMoney(liabilities, { showCents: false })} + Equity {formatMoney(equity, { showCents: false })}
        </div>
      </div>
    </Card>
  );
}
