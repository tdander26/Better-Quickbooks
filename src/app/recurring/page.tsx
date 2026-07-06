// Recurring — surfaces the subscriptions, bills and payroll we can infer from
// the transaction history. A Server Component: it loads every transaction, runs
// the pure detectSeries() heuristic, and renders "money out" / "money in"
// sections plus a monthly-spend summary. No mutations, read-only view.
import { differenceInDays, format, formatDistanceToNow } from "date-fns";
import { clsx } from "clsx";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getBusinessContext } from "@/lib/session";
import { PageHeader, Card, StatTile, Money, Badge, EmptyState } from "@/components/ui";
import { CategoryIcon } from "@/lib/icons";
import { detectSeries, type Series } from "@/lib/recurring-series";

// Depends on live transaction data; never statically cache.
export const dynamic = "force-dynamic";

// Cadence -> tone for the little cadence pill.
const CADENCE_TONE: Record<Series["cadence"], "green" | "blue" | "amber" | "neutral"> = {
  Weekly: "blue",
  Biweekly: "blue",
  Monthly: "green",
  Irregular: "amber",
};

/** Normalize a series' average amount to a monthly figure (in cents). */
function monthlyCents(s: Series): number {
  const gap = s.medianGapDays > 0 ? s.medianGapDays : 30;
  return Math.round(Math.abs(s.avgAmountCents) * (30 / gap));
}

export default async function RecurringPage() {
  const ctx = await getBusinessContext();
  const txns = await prisma.transaction.findMany({
    where: { businessId: ctx.businessId },
    orderBy: { postedAt: "asc" },
    include: { splits: { include: { category: true } } },
  });

  const series = detectSeries(
    txns.map((t) => ({
      id: t.id,
      payee: t.payee,
      amountCents: t.amountCents,
      postedAt: t.postedAt,
      // Use the first split's category as the transaction's representative one.
      categoryName: t.splits[0]?.category?.name ?? null,
    }))
  );

  const moneyOut = series.filter((s) => s.avgAmountCents < 0);
  const moneyIn = series.filter((s) => s.avgAmountCents >= 0);

  const monthlyRecurring = moneyOut.reduce((sum, s) => sum + monthlyCents(s), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recurring"
        subtitle="Recurring payments we spotted — subscriptions, bills, and payroll."
      />

      {series.length === 0 ? (
        <EmptyState
          title="No recurring payments yet"
          hint="We look for payees that show up three or more times. Once you have a bit more history, subscriptions and bills will appear here automatically."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatTile label="Series found" value={series.length} sub="Recurring payees" />
            <StatTile
              label="Monthly recurring"
              value={formatMoney(monthlyRecurring, { showCents: false })}
              tone="red"
              sub="Expenses, normalized to /mo"
            />
            <div className="col-span-2 md:col-span-1">
              <StatTile
                label="Money in vs out"
                value={`${moneyIn.length} in · ${moneyOut.length} out`}
                sub="Incoming vs outgoing series"
              />
            </div>
          </div>

          {moneyOut.length > 0 && <SeriesSection title="Money out" series={moneyOut} />}
          {moneyIn.length > 0 && <SeriesSection title="Money in" series={moneyIn} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SeriesSection({ title, series }: { title: string; series: Series[] }) {
  return (
    <section>
      <h2 className="muted mb-2 text-xs font-semibold uppercase tracking-wide">{title}</h2>
      <div className="space-y-2">
        {series.map((s) => (
          <SeriesRow key={s.key} s={s} />
        ))}
      </div>
    </section>
  );
}

function SeriesRow({ s }: { s: Series }) {
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10">
          <CategoryIcon name={null} size={16} className="muted" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium capitalize">{s.displayPayee}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {s.categoryName && (
              <span className="chip bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300">
                {s.categoryName}
              </span>
            )}
            <Badge tone={CADENCE_TONE[s.cadence]}>{s.cadence}</Badge>
            <span className="muted text-xs">{s.count}×</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 sm:justify-end sm:gap-6">
        <div className="text-right">
          <Money cents={s.avgAmountCents} className="text-sm font-semibold" />
          <div className="muted text-xs">avg · last {format(s.lastDate, "MMM d")}</div>
        </div>
        <div className="shrink-0 text-right">
          <NextExpected date={s.nextExpectedDate} />
        </div>
      </div>
    </Card>
  );
}

function NextExpected({ date }: { date: Date }) {
  const days = differenceInDays(date, new Date());
  let tone: "red" | "amber" | "neutral" = "neutral";
  let label = format(date, "MMM d");
  if (days < 0) {
    tone = "red";
    label = "Overdue";
  } else if (days <= 5) {
    tone = "amber";
    label = "Due soon";
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge tone={tone}>{label}</Badge>
      <span className={clsx("muted text-xs", days < 0 && "text-rose-600 dark:text-rose-400")}>
        {days < 0 ? `${formatDistanceToNow(date)} ago` : `in ${formatDistanceToNow(date)}`}
      </span>
    </div>
  );
}
