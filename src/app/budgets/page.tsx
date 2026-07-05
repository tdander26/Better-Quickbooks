// Budgets — set a monthly spending target per expense category and track it
// against actuals. A Server Component: figures are computed on the server
// (budgets lib + reports engine) for the month in ?month=YYYY-MM (defaults to
// the current month). The month switcher is plain links; the per-row editing
// lives in the sibling client component.
import Link from "next/link";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { format, parse, addMonths, subMonths, isValid } from "date-fns";
import { budgetVsActual, monthKey } from "@/lib/budgets";
import { formatMoney } from "@/lib/money";
import { PageHeader, StatTile } from "@/components/ui";
import { BudgetList } from "./_client";

// Financial data is per-request and depends on searchParams; never cache.
export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-\d{2}$/;

/** Resolve the ?month= param to a valid "YYYY-MM", defaulting to this month. */
function resolveMonth(raw: string | undefined): string {
  if (raw && MONTH_RE.test(raw)) {
    const d = parse(raw, "yyyy-MM", new Date());
    if (isValid(d)) return raw;
  }
  return monthKey(new Date());
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const month = resolveMonth(sp.month);
  const monthDate = parse(month, "yyyy-MM", new Date());

  const prev = monthKey(subMonths(monthDate, 1));
  const next = monthKey(addMonths(monthDate, 1));
  const monthLabel = format(monthDate, "MMMM yyyy");

  const { lines, totalBudget, totalActual } = await budgetVsActual(month);
  const remaining = totalBudget - totalActual;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Budgets"
        subtitle="Set a monthly target for each expense category and track your spending"
      />

      {/* Month switcher */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/budgets?month=${prev}`}
          scroll={false}
          className="btn-ghost shrink-0"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
          <span className="hidden sm:inline">Prev</span>
        </Link>
        <div className="min-w-0 text-center">
          <div className="text-base font-semibold tracking-tight">{monthLabel}</div>
        </div>
        <Link
          href={`/budgets?month=${next}`}
          scroll={false}
          className="btn-ghost shrink-0"
          aria-label="Next month"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight size={16} />
        </Link>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile
          label="Total budget"
          value={formatMoney(totalBudget, { showCents: false })}
          sub="Planned for the month"
        />
        <StatTile
          label="Total spent"
          value={formatMoney(totalActual, { showCents: false })}
          tone="red"
          sub="Actual spending"
        />
        <div className="col-span-2 md:col-span-1">
          <StatTile
            label="Remaining"
            value={formatMoney(remaining, { showCents: false, signed: true })}
            tone={remaining >= 0 ? "green" : "red"}
            sub={remaining >= 0 ? "Left to spend" : "Over budget"}
          />
        </div>
      </div>

      <BudgetList lines={lines} month={month} />

      {totalBudget === 0 && lines.length > 0 && (
        <p className="muted flex items-center gap-2 px-1 text-sm">
          <Wallet size={15} />
          Set a dollar amount on a category to start tracking a budget for {monthLabel}.
        </p>
      )}
    </div>
  );
}
