// Dashboard — the financial home screen ("/"). A Server Component: every figure
// is computed on the server (reports lib + prisma directly, no fetch) and handed
// to small client chart components for rendering. Auth is enforced by middleware.
import Link from "next/link";
import { startOfMonth, endOfMonth, format } from "date-fns";
import {
  TrendingUp,
  PieChart,
  Landmark,
  CreditCard,
  Receipt,
  ChevronRight,
  ArrowRight,
  Sparkles,
  PartyPopper,
  Inbox,
  Clock,
  PlusCircle,
  type LucideIcon,
} from "lucide-react";

import { prisma } from "@/lib/db";
import {
  netWorth,
  profitAndLoss,
  spendingByCategory,
  monthlyTrend,
  accountBalances,
} from "@/lib/reports";
import { getBusinessContext } from "@/lib/session";
import { UNCATEGORIZED } from "@/lib/types";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { Card, PageHeader, Money, StatTile, Badge, EmptyState } from "@/components/ui";
import { TrendChart, CategoryDonut } from "@/components/charts";
import { Onboarding } from "@/components/Onboarding";

// Financial data is per-request; never statically cache the dashboard.
export const dynamic = "force-dynamic";

const DONUT_TOP = 6;

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function PanelHeader({
  icon: Icon,
  title,
  href,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-400">
          <Icon size={16} />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {href && (
        <Link
          href={href}
          className="muted inline-flex items-center gap-0.5 text-xs font-medium transition hover:text-brand-600 dark:hover:text-brand-400"
        >
          {cta ?? "View all"}
          <ChevronRight size={14} />
        </Link>
      )}
    </div>
  );
}

export default async function Dashboard() {
  const ctx = await getBusinessContext();
  const businessId = ctx.businessId;

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  // A transaction "needs categorizing" when ALL of its splits are uncategorized
  // (no categorized split): every split is either category-less or points at the
  // system "Uncategorized" category, and at least one such split exists.
  const [nw, pl, spending, trend, balances, recent, uncategorizedCount, pendingCount] =
    await Promise.all([
      netWorth(businessId),
      profitAndLoss(businessId, monthStart, monthEnd),
      spendingByCategory(businessId, monthStart, monthEnd),
      monthlyTrend(businessId, 6),
      accountBalances(businessId),
      prisma.transaction.findMany({
        where: { businessId },
        take: 6,
        orderBy: { postedAt: "desc" },
        include: { account: true, splits: { include: { category: true } } },
      }),
      prisma.transaction.count({
        where: {
          businessId,
          splits: {
            some: { OR: [{ categoryId: null }, { category: { is: { name: UNCATEGORIZED } } }] },
            every: { OR: [{ categoryId: null }, { category: { is: { name: UNCATEGORIZED } } }] },
          },
        },
      }),
      prisma.transaction.count({ where: { businessId, pending: true } }),
    ]);

  // Donut: top categories by spend + an aggregated "Other" bucket.
  const donutData = spending.slice(0, DONUT_TOP).map((l) => ({
    name: l.category,
    amountCents: l.amountCents,
  }));
  const otherCents = spending.slice(DONUT_TOP).reduce((n, l) => n + l.amountCents, 0);
  if (otherCents > 0) donutData.push({ name: "Other", amountCents: otherCents });

  const assets = balances.filter((b) => b.classification === "asset");
  const liabilities = balances.filter((b) => b.classification === "liability");

  const attentionCount = uncategorizedCount + pendingCount;
  const monthLabel = format(now, "MMMM");

  // Fresh install / empty database (e.g. right after a deploy): show onboarding.
  if (balances.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title={greetingFor(now.getHours())}
          subtitle={format(now, "EEEE · MMMM d, yyyy")}
        />
        <Onboarding />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <PageHeader
        title={greetingFor(now.getHours())}
        subtitle={format(now, "EEEE · MMMM d, yyyy")}
      />

      {/* 1 — Headline stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Net Worth"
          value={formatMoney(nw.netWorthCents, { showCents: false })}
          sub={`${formatMoneyCompact(nw.assetsCents)} cash · ${formatMoneyCompact(nw.liabilitiesCents)} owed`}
        />
        <StatTile
          label={`Income · ${monthLabel}`}
          value={formatMoney(pl.totalIncomeCents, { showCents: false })}
          tone="green"
          sub="this month"
        />
        <StatTile
          label={`Expenses · ${monthLabel}`}
          value={formatMoney(pl.totalExpenseCents, { showCents: false })}
          tone="red"
          sub="this month"
        />
        <StatTile
          label="Net · This Month"
          value={formatMoney(pl.netIncomeCents, { showCents: false, signed: true })}
          tone={pl.netIncomeCents >= 0 ? "green" : "red"}
          sub="income − expenses"
        />
      </div>

      {/* 2 — Needs attention */}
      <Card className="p-4 sm:p-5">
        {attentionCount === 0 ? (
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400">
              <PartyPopper size={22} />
            </span>
            <div>
              <div className="font-semibold">All caught up 🎉</div>
              <div className="muted text-sm">
                Every transaction is categorized and posted. Nice work.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <Sparkles size={22} />
              </span>
              <div>
                <div className="font-semibold">Needs attention</div>
                <div className="muted mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                  {uncategorizedCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Inbox size={14} />
                      {uncategorizedCount} to categorize
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={14} />
                      {pendingCount} pending
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Link href="/transactions?filter=uncategorized" className="btn-primary shrink-0">
              Review
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </Card>

      {/* 3 & 4 — Trend + spending donut */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <PanelHeader icon={TrendingUp} title="Income vs Expenses" href="/reports" cta="Reports" />
          <TrendChart data={trend} />
        </Card>
        <Card className="p-4 sm:p-5">
          <PanelHeader icon={PieChart} title={`Spending · ${monthLabel}`} href="/reports" cta="Details" />
          <CategoryDonut data={donutData} />
        </Card>
      </div>

      {/* 5 & 6 — Accounts snapshot + recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <PanelHeader icon={Landmark} title="Accounts" href="/accounts" />
          {balances.length === 0 ? (
            <EmptyState
              title="No accounts yet"
              hint="Connect a bank feed or add an account to start tracking balances."
              action={
                <Link href="/accounts" className="btn-primary mt-1">
                  <PlusCircle size={16} />
                  Add account
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {assets.length > 0 && (
                <div>
                  <div className="muted mb-0.5 text-xs font-medium uppercase tracking-wide">Cash</div>
                  <div className="divide-y divide-black/5 dark:divide-white/10">
                    {assets.map((b) => (
                      <AccountRow key={b.id} b={b} />
                    ))}
                  </div>
                </div>
              )}
              {liabilities.length > 0 && (
                <div>
                  <div className="muted mb-0.5 text-xs font-medium uppercase tracking-wide">
                    Credit cards
                  </div>
                  <div className="divide-y divide-black/5 dark:divide-white/10">
                    {liabilities.map((b) => (
                      <AccountRow key={b.id} b={b} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <PanelHeader icon={Receipt} title="Recent activity" href="/transactions" />
          {recent.length === 0 ? (
            <p className="muted py-6 text-center text-sm">No transactions yet.</p>
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/10">
              {recent.map((t) => {
                const label =
                  t.splits.length > 1 ? "Split" : t.splits[0]?.category?.name ?? UNCATEGORIZED;
                const payee = t.payee || t.description || "Transaction";
                const tone =
                  label === UNCATEGORIZED ? "amber" : label === "Split" ? "blue" : "neutral";
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{payee}</div>
                      <div className="muted mt-0.5 flex items-center gap-1.5 text-xs">
                        <span className="truncate">{t.account.name}</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">{format(t.postedAt, "MMM d")}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Money cents={t.amountCents} className="text-sm" />
                      <Badge tone={tone}>{label}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function AccountRow({
  b,
}: {
  b: { id: string; name: string; institution: string; type: string; computedCents: number };
}) {
  const Icon = b.type === "credit_card" ? CreditCard : Landmark;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10">
        <Icon size={16} className="muted" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{b.name}</div>
        <div className="muted truncate text-xs">{b.institution}</div>
      </div>
      <Money cents={b.computedCents} className="text-sm" />
    </div>
  );
}
