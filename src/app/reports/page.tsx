// Reports — Profit & Loss (with prior-period comparison), Balance Sheet (as of a
// date), Cash Flow, and a Profit-&-Loss-by-month grid, rendered as clean,
// friendly financial statements. A Server Component: figures are computed on the
// server (reports lib + prisma) and handed to small sync render helpers. The
// range + tab + account + export controls live in a sibling client component.
import type { ReactNode } from "react";
import Link from "next/link";
import { parseISO, endOfDay, startOfYear, format } from "date-fns";
import { clsx } from "clsx";
import { Landmark, CreditCard, CheckCircle2, AlertTriangle } from "lucide-react";
import { prisma } from "@/lib/db";
import {
  profitAndLoss,
  balanceSheetAsOf,
  cashFlow,
  monthlyByCategory,
  type AccountBalance,
  type ProfitAndLoss,
  type BalanceSheet,
  type MonthlyByCategory,
} from "@/lib/reports";
import { formatMoney } from "@/lib/money";
import { PageHeader, Card, StatTile, Money, EmptyState } from "@/components/ui";
import { ReportControls } from "./_controls";

// Financial data is per-request and depends on searchParams; never cache.
export const dynamic = "force-dynamic";

type Tab = "pl" | "balance" | "cashflow" | "monthly";

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

/** The balance-sheet point-in-time date (?asOf=), end-inclusive, default today. */
function resolveAsOf(sp: Record<string, string | undefined>) {
  const now = new Date();
  if (sp.asOf) {
    const p = parseISO(sp.asOf);
    if (!isNaN(p.getTime())) return endOfDay(p);
  }
  return now;
}

/** Build a drill-down link into the transactions register for a report line. */
function txnHref(
  categoryId: string | null,
  startStr: string,
  endStr: string,
  account: string
) {
  const p = new URLSearchParams();
  if (categoryId) p.set("category", categoryId);
  else p.set("filter", "uncategorized");
  p.set("start", startStr);
  p.set("end", endStr);
  if (account) p.set("account", account);
  return `/transactions?${p.toString()}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "balance" || sp.tab === "cashflow" || sp.tab === "monthly" ? sp.tab : "pl";

  const { start, end } = resolveRange(sp);
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");

  const asOf = resolveAsOf(sp);
  const asOfStr = format(asOf, "yyyy-MM-dd");

  // Accounts power the filter dropdown and validate the ?account= param.
  const accounts = await prisma.account.findMany({
    where: { archived: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, institution: true },
  });
  const accountIds = new Set(accounts.map((a) => a.id));
  const account = sp.account && accountIds.has(sp.account) ? sp.account : "";
  const accountName = account ? accounts.find((a) => a.id === account)?.name ?? "" : "";

  const isAllTime = startStr === ALL_TIME_START;
  const baseLabel = isAllTime
    ? `All time · through ${format(end, "MMM d, yyyy")}`
    : `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  const rangeLabel = accountName ? `${baseLabel} · ${accountName}` : baseLabel;

  // Prior period: same-length window immediately before the selected range.
  const lenMs = end.getTime() - start.getTime();
  const priorEnd = new Date(start.getTime() - 1);
  const priorStart = new Date(priorEnd.getTime() - lenMs);
  const priorLabel = `${format(priorStart, "MMM d, yyyy")} – ${format(priorEnd, "MMM d, yyyy")}`;

  const accountId = account || undefined;

  // Only the active tab's data is fetched (short-circuits before the await).
  let content: ReactNode;
  if (tab === "balance") {
    content = <BalanceReport data={await balanceSheetAsOf(asOf)} />;
  } else if (tab === "cashflow") {
    content = (
      <CashFlowReport
        data={await cashFlow(start, end, accountId)}
        rangeLabel={rangeLabel}
        startStr={startStr}
        endStr={endStr}
        account={account}
      />
    );
  } else if (tab === "monthly") {
    content = <MonthlyReport data={await monthlyByCategory(6)} />;
  } else {
    const [data, prior] = await Promise.all([
      profitAndLoss(start, end, accountId),
      profitAndLoss(priorStart, priorEnd, accountId),
    ]);
    content = (
      <PLReport
        data={data}
        prior={prior}
        rangeLabel={rangeLabel}
        priorLabel={priorLabel}
        startStr={startStr}
        endStr={endStr}
        account={account}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Profit & loss, balance sheet, and cash flow" />
      <ReportControls
        tab={tab}
        start={startStr}
        end={endStr}
        account={account}
        asOf={asOfStr}
        accounts={accounts}
      />
      {content}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profit & Loss (with prior-period comparison)                       */
/* ------------------------------------------------------------------ */

interface CompareRow {
  categoryId: string | null;
  category: string;
  current: number;
  prior: number;
}

/** Union of category lines across the current and prior periods. */
function mergeLines(current: ProfitAndLoss["income"], prior: ProfitAndLoss["income"]): CompareRow[] {
  const key = (l: { categoryId: string | null; category: string }) =>
    l.categoryId ?? `u-${l.category}`;
  const priorMap = new Map(prior.map((l) => [key(l), l.amountCents]));
  const seen = new Set<string>();
  const rows: CompareRow[] = current.map((l) => {
    seen.add(key(l));
    return {
      categoryId: l.categoryId,
      category: l.category,
      current: l.amountCents,
      prior: priorMap.get(key(l)) ?? 0,
    };
  });
  for (const l of prior) {
    if (!seen.has(key(l))) {
      rows.push({ categoryId: l.categoryId, category: l.category, current: 0, prior: l.amountCents });
    }
  }
  return rows.sort((a, b) => b.current - a.current || b.prior - a.prior);
}

function PLReport({
  data,
  prior,
  rangeLabel,
  priorLabel,
  startStr,
  endStr,
  account,
}: {
  data: ProfitAndLoss;
  prior: ProfitAndLoss;
  rangeLabel: string;
  priorLabel: string;
  startStr: string;
  endStr: string;
  account: string;
}) {
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
  const netDelta = data.netIncomeCents - prior.netIncomeCents;

  const incomeRows = mergeLines(data.income, prior.income);
  const expenseRows = mergeLines(data.expenses, prior.expenses);

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
            sub={`${formatMoney(netDelta, { showCents: false, signed: true })} vs prior period`}
          />
        </div>
      </div>

      <StatementCard title="Profit & Loss" meta={rangeLabel}>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="muted text-[11px] uppercase tracking-wide">
                <th className="py-2 pr-3 text-left font-semibold">Category</th>
                <th className="px-3 py-2 text-right font-semibold">This period</th>
                <th className="px-3 py-2 text-right font-semibold">Prior</th>
                <th className="px-3 py-2 text-right font-semibold">Δ</th>
                <th className="py-2 pl-3 text-right font-semibold">Δ %</th>
              </tr>
              <tr className="text-[11px]">
                <th />
                <th className="muted px-3 pb-2 text-right font-normal">{rangeLabel.split(" · ")[0]}</th>
                <th className="muted px-3 pb-2 text-right font-normal">{priorLabel}</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              <SectionRow label="Income" />
              {incomeRows.length ? (
                incomeRows.map((r) => (
                  <PLRow
                    key={r.categoryId ?? `inc-${r.category}`}
                    row={r}
                    goodWhenUp
                    href={txnHref(r.categoryId, startStr, endStr, account)}
                  />
                ))
              ) : (
                <EmptyTableRow label="No income in this period" />
              )}
              <SubtotalRow label="Total income" current={inc} prior={prior.totalIncomeCents} goodWhenUp />

              <SectionRow label="Expenses" />
              {expenseRows.length ? (
                expenseRows.map((r) => (
                  <PLRow
                    key={r.categoryId ?? `exp-${r.category}`}
                    row={r}
                    goodWhenUp={false}
                    href={txnHref(r.categoryId, startStr, endStr, account)}
                  />
                ))
              ) : (
                <EmptyTableRow label="No expenses in this period" />
              )}
              <SubtotalRow label="Total expenses" current={exp} prior={prior.totalExpenseCents} goodWhenUp={false} />

              <NetRow label="Net income" current={data.netIncomeCents} prior={prior.netIncomeCents} />
            </tbody>
          </table>
        </div>
      </StatementCard>
    </div>
  );
}

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null; // null = no comparable base
  return ((current - prior) / Math.abs(prior)) * 100;
}

function deltaTone(delta: number, goodWhenUp: boolean): string {
  if (delta === 0) return "muted";
  const favorable = delta > 0 === goodWhenUp;
  return favorable ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

function PLRow({ row, goodWhenUp, href }: { row: CompareRow; goodWhenUp: boolean; href: string }) {
  const delta = row.current - row.prior;
  const p = pctChange(row.current, row.prior);
  const tone = deltaTone(delta, goodWhenUp);
  return (
    <tr className="border-t" style={{ borderColor: "var(--border)" }}>
      <td className="max-w-[220px] truncate py-2 pr-3">
        <Link href={href} className="hover:text-brand-700 hover:underline dark:hover:text-brand-300">
          {row.category}
        </Link>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.current, { showCents: false })}</td>
      <td className="muted px-3 py-2 text-right tabular-nums">{formatMoney(row.prior, { showCents: false })}</td>
      <td className={clsx("px-3 py-2 text-right tabular-nums", tone)}>
        {formatMoney(delta, { showCents: false, signed: true })}
      </td>
      <td className={clsx("py-2 pl-3 text-right tabular-nums", tone)}>
        {p === null ? "—" : `${p > 0 ? "+" : ""}${p.toFixed(0)}%`}
      </td>
    </tr>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={5} className="muted pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide">
        {label}
      </td>
    </tr>
  );
}

function SubtotalRow({
  label,
  current,
  prior,
  goodWhenUp,
}: {
  label: string;
  current: number;
  prior: number;
  goodWhenUp: boolean;
}) {
  const delta = current - prior;
  const p = pctChange(current, prior);
  const tone = deltaTone(delta, goodWhenUp);
  return (
    <tr className="border-t font-semibold" style={{ borderColor: "var(--border)" }}>
      <td className="py-2.5 pr-3">{label}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(current, { showCents: false })}</td>
      <td className="muted px-3 py-2.5 text-right tabular-nums">{formatMoney(prior, { showCents: false })}</td>
      <td className={clsx("px-3 py-2.5 text-right tabular-nums", tone)}>
        {formatMoney(delta, { showCents: false, signed: true })}
      </td>
      <td className={clsx("py-2.5 pl-3 text-right tabular-nums", tone)}>
        {p === null ? "—" : `${p > 0 ? "+" : ""}${p.toFixed(0)}%`}
      </td>
    </tr>
  );
}

function NetRow({ label, current, prior }: { label: string; current: number; prior: number }) {
  const delta = current - prior;
  const p = pctChange(current, prior);
  const positive = current >= 0;
  return (
    <tr
      className={clsx(
        "border-t-2 text-base font-bold",
        positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      )}
      style={{ borderColor: "var(--border)" }}
    >
      <td className="py-3 pr-3">{label}</td>
      <td className="px-3 py-3 text-right tabular-nums">{formatMoney(current, { showCents: false, signed: true })}</td>
      <td className="muted px-3 py-3 text-right text-sm font-semibold tabular-nums">
        {formatMoney(prior, { showCents: false, signed: true })}
      </td>
      <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">
        {formatMoney(delta, { showCents: false, signed: true })}
      </td>
      <td className="py-3 pl-3 text-right text-sm font-semibold tabular-nums">
        {p === null ? "—" : `${p > 0 ? "+" : ""}${p.toFixed(0)}%`}
      </td>
    </tr>
  );
}

function EmptyTableRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={5} className="muted py-2 text-sm">
        {label}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Cash Flow                                                          */
/* ------------------------------------------------------------------ */

function CashFlowReport({
  data,
  rangeLabel,
  startStr,
  endStr,
  account,
}: {
  data: Awaited<ReturnType<typeof cashFlow>>;
  rangeLabel: string;
  startStr: string;
  endStr: string;
  account: string;
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
                href={txnHref(l.categoryId, startStr, endStr, account)}
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
                href={txnHref(l.categoryId, startStr, endStr, account)}
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

/* ------------------------------------------------------------------ */
/* Profit & Loss by month (grid)                                      */
/* ------------------------------------------------------------------ */

function MonthlyReport({ data }: { data: MonthlyByCategory }) {
  if (!data.income.length && !data.expenses.length) {
    return (
      <EmptyState
        title="No activity in the last 6 months"
        hint="Once transactions are categorized, this grid shows each category month by month."
      />
    );
  }

  const cell = (cents: number, opts: { strong?: boolean; net?: boolean } = {}) => (
    <td
      className={clsx(
        "px-3 py-2 text-right tabular-nums",
        opts.strong && "font-semibold",
        opts.net && (cents >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")
      )}
    >
      {cents === 0 && !opts.net ? <span className="muted">—</span> : formatMoney(cents, { showCents: false, signed: opts.net })}
    </td>
  );

  return (
    <StatementCard title="Profit & Loss by month" meta={`Last ${data.months.length} months`}>
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="muted text-[11px] uppercase tracking-wide">
              <th className="sticky left-0 z-10 bg-[var(--card)] py-2 pr-3 text-left font-semibold">Category</th>
              {data.months.map((m) => (
                <th key={m.key} className="px-3 py-2 text-right font-semibold">
                  {m.label}
                </th>
              ))}
              <th className="py-2 pl-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={data.months.length + 2}
                className="muted pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide"
              >
                Income
              </td>
            </tr>
            {data.income.map((r) => (
              <tr key={r.categoryId ?? `inc-${r.category}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="sticky left-0 z-10 max-w-[200px] truncate bg-[var(--card)] py-2 pr-3">{r.category}</td>
                {data.months.map((m) => cell(r.values[m.key] ?? 0))}
                {cell(r.totalCents, { strong: true })}
              </tr>
            ))}
            <tr className="border-t font-semibold" style={{ borderColor: "var(--border)" }}>
              <td className="sticky left-0 z-10 bg-[var(--card)] py-2 pr-3">Total income</td>
              {data.months.map((m) => cell(data.incomeTotals[m.key] ?? 0, { strong: true }))}
              {cell(data.totalIncomeCents, { strong: true })}
            </tr>

            <tr>
              <td
                colSpan={data.months.length + 2}
                className="muted pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide"
              >
                Expenses
              </td>
            </tr>
            {data.expenses.map((r) => (
              <tr key={r.categoryId ?? `exp-${r.category}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="sticky left-0 z-10 max-w-[200px] truncate bg-[var(--card)] py-2 pr-3">{r.category}</td>
                {data.months.map((m) => cell(r.values[m.key] ?? 0))}
                {cell(r.totalCents, { strong: true })}
              </tr>
            ))}
            <tr className="border-t font-semibold" style={{ borderColor: "var(--border)" }}>
              <td className="sticky left-0 z-10 bg-[var(--card)] py-2 pr-3">Total expenses</td>
              {data.months.map((m) => cell(data.expenseTotals[m.key] ?? 0, { strong: true }))}
              {cell(data.totalExpenseCents, { strong: true })}
            </tr>

            <tr className="border-t-2 text-sm font-bold" style={{ borderColor: "var(--border)" }}>
              <td className="sticky left-0 z-10 bg-[var(--card)] py-3 pr-3">Net income</td>
              {data.months.map((m) => cell(data.netByMonth[m.key] ?? 0, { strong: true, net: true }))}
              {cell(data.netIncomeCents, { strong: true, net: true })}
            </tr>
          </tbody>
        </table>
      </div>
    </StatementCard>
  );
}

/* ------------------------------------------------------------------ */
/* Balance Sheet                                                      */
/* ------------------------------------------------------------------ */

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
  href,
}: {
  label: string;
  cents: number;
  share?: number;
  tone?: "green" | "red";
  href?: string;
}) {
  const labelEl = href ? (
    <Link href={href} className="min-w-0 truncate text-sm hover:text-brand-700 hover:underline dark:hover:text-brand-300">
      {label}
    </Link>
  ) : (
    <span className="min-w-0 truncate text-sm">{label}</span>
  );
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-4">
        {labelEl}
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
    <Link
      href={`/accounts/${b.id}`}
      className="-mx-1 flex items-center gap-3 rounded-xl px-1 py-2 transition hover:bg-black/5 dark:hover:bg-white/5"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10">
        <Icon size={15} className="muted" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{b.name}</div>
        <div className="muted truncate text-xs">{b.institution}</div>
      </div>
      <Money cents={cents} plain className="shrink-0 text-sm" />
    </Link>
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
