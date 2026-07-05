// Tax summary — groups the year's categorized activity by each category's
// `taxLine` (the Schedule C / tax-form line set in Settings), so the numbers
// line up with a tax return. Income lines are summed as positive money in;
// expense/deduction lines are summed as magnitudes (money out). A Server
// Component: everything is computed on the server from prisma.
import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { prisma } from "@/lib/db";
import { PageHeader, Card, StatTile, Money, EmptyState, Badge } from "@/components/ui";
import { formatMoney } from "@/lib/money";

// Depends on the year param + live data; never cache.
export const dynamic = "force-dynamic";

interface TaxLine {
  taxLine: string;
  categories: string[];
  amountCents: number;
}

function resolveYear(raw: string | undefined): number {
  const now = new Date().getFullYear();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1970 || n > now + 1) return now;
  return n;
}

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const year = resolveYear(sp.year);

  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);

  // Only categories that carry a tax-line mapping and belong to a P&L section
  // contribute to the summary.
  const [splits, unmapped, mappedCount] = await Promise.all([
    prisma.split.findMany({
      where: {
        transaction: { is: { postedAt: { gte: start, lte: end } } },
        category: { is: { taxLine: { not: "" }, section: { in: ["income", "expense"] } } },
      },
      select: {
        amountCents: true,
        category: { select: { name: true, section: true, taxLine: true } },
      },
    }),
    prisma.category.findMany({
      where: { taxLine: "", section: { in: ["income", "expense"] } },
      orderBy: [{ section: "asc" }, { name: "asc" }],
      select: { id: true, name: true, section: true },
    }),
    prisma.category.count({
      where: { taxLine: { not: "" }, section: { in: ["income", "expense"] } },
    }),
  ]);

  // Aggregate by tax line, split into income vs. deduction buckets.
  const incomeMap = new Map<string, TaxLine>();
  const expenseMap = new Map<string, TaxLine>();

  for (const s of splits) {
    const cat = s.category;
    if (!cat || !cat.taxLine) continue;
    const isIncome = cat.section === "income";
    const map = isIncome ? incomeMap : expenseMap;
    const amount = isIncome ? s.amountCents : Math.abs(s.amountCents);

    const entry = map.get(cat.taxLine) ?? { taxLine: cat.taxLine, categories: [], amountCents: 0 };
    entry.amountCents += amount;
    if (!entry.categories.includes(cat.name)) entry.categories.push(cat.name);
    map.set(cat.taxLine, entry);
  }

  const incomeLines = [...incomeMap.values()].sort((a, b) => a.taxLine.localeCompare(b.taxLine));
  const expenseLines = [...expenseMap.values()].sort((a, b) => a.taxLine.localeCompare(b.taxLine));
  const incomeTotal = incomeLines.reduce((n, l) => n + l.amountCents, 0);
  const expenseTotal = expenseLines.reduce((n, l) => n + l.amountCents, 0);
  const netCents = incomeTotal - expenseTotal;

  const thisYear = new Date().getFullYear();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tax summary"
        subtitle="Your year's income and deductions grouped by tax-form line"
        actions={<YearSwitcher year={year} thisYear={thisYear} />}
      />

      {mappedCount === 0 ? (
        <EmptyState
          title="No tax lines set yet"
          hint="Assign a tax line (like a Schedule C line) to your income and expense categories in Settings, and this page will total your activity by that line for the selected year."
          action={
            <Link href="/settings" className="btn-primary mt-1">
              Go to Settings
            </Link>
          }
        />
      ) : incomeLines.length === 0 && expenseLines.length === 0 ? (
        <EmptyState
          title={`No mapped activity in ${year}`}
          hint="None of your tax-mapped categories had transactions this year. Try another year, or check that transactions are categorized."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatTile
              label="Taxable income"
              value={formatMoney(incomeTotal, { showCents: false })}
              tone="green"
              sub="Money in on mapped lines"
            />
            <StatTile
              label="Deductions"
              value={formatMoney(expenseTotal, { showCents: false })}
              tone="red"
              sub="Deductible expenses"
            />
            <div className="col-span-2 md:col-span-1">
              <StatTile
                label="Net"
                value={formatMoney(netCents, { showCents: false, signed: true })}
                tone={netCents >= 0 ? "green" : "red"}
                sub="Income − deductions"
              />
            </div>
          </div>

          <Card className="p-4 sm:p-5">
            <div
              className="mb-3 flex items-end justify-between gap-3 border-b pb-3"
              style={{ borderColor: "var(--border)" }}
            >
              <h2 className="text-base font-semibold tracking-tight">Tax summary</h2>
              <span className="muted text-right text-xs">Calendar year {year}</span>
            </div>

            <TaxSection
              title="Income"
              lines={incomeLines}
              subtotalLabel="Total income"
              subtotal={incomeTotal}
              emptyLabel="No mapped income this year"
            />
            <TaxSection
              title="Deductions & expenses"
              lines={expenseLines}
              subtotalLabel="Total deductions"
              subtotal={expenseTotal}
              emptyLabel="No mapped deductions this year"
            />

            <div
              className={
                "mt-4 flex items-center justify-between gap-4 rounded-2xl px-4 py-3 ring-1 ring-inset " +
                (netCents >= 0
                  ? "bg-emerald-500/5 ring-emerald-500/15"
                  : "bg-rose-500/5 ring-rose-500/15")
              }
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold">Net taxable</div>
                <div className="muted text-xs">Income − deductions</div>
              </div>
              <Money cents={netCents} className="shrink-0 text-lg font-bold" />
            </div>
          </Card>

          <p className="muted flex items-start gap-2 text-xs">
            <Info size={14} className="mt-0.5 shrink-0" />
            These totals are a starting point for tax prep, not tax advice. Every categorized
            transaction posted in {year} counts toward the tax line set on its category.
          </p>
        </>
      )}

      {unmapped.length > 0 && (
        <Card className="p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">Not mapped yet</h2>
            <Badge tone="amber">{unmapped.length}</Badge>
          </div>
          <p className="muted mb-3 text-xs">
            These income and expense categories have no tax line, so they&apos;re left out of the
            summary above. Set a tax line on each one in Settings to include it.
          </p>
          <ul className="flex flex-wrap gap-2">
            {unmapped.map((c) => (
              <li key={c.id}>
                <Badge tone={c.section === "income" ? "green" : "neutral"}>{c.name}</Badge>
              </li>
            ))}
          </ul>
          <Link href="/settings" className="btn-ghost mt-3 text-xs">
            Set tax lines in Settings
          </Link>
        </Card>
      )}
    </div>
  );
}

function YearSwitcher({ year, thisYear }: { year: number; thisYear: number }) {
  // A compact range of years around "now", always including the selected one.
  const years = new Set<number>();
  for (let y = thisYear; y >= thisYear - 4; y--) years.add(y);
  years.add(year);
  const list = [...years].sort((a, b) => b - a);

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/tax?year=${year - 1}`}
        aria-label="Previous year"
        className="btn-ghost px-2"
      >
        <ChevronLeft size={16} />
      </Link>
      <div className="flex items-center gap-1">
        {list.map((y) => (
          <Link
            key={y}
            href={`/tax?year=${y}`}
            className={
              "chip tabular-nums transition " +
              (y === year
                ? "bg-brand-500/15 text-brand-600 dark:text-brand-300"
                : "muted hover:bg-black/5 dark:hover:bg-white/10")
            }
          >
            {y}
          </Link>
        ))}
      </div>
      <Link
        href={`/tax?year=${year + 1}`}
        aria-label="Next year"
        aria-disabled={year >= thisYear + 1}
        className={
          "btn-ghost px-2 " + (year >= thisYear + 1 ? "pointer-events-none opacity-40" : "")
        }
      >
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}

function TaxSection({
  title,
  lines,
  subtotalLabel,
  subtotal,
  emptyLabel,
}: {
  title: string;
  lines: TaxLine[];
  subtotalLabel: string;
  subtotal: number;
  emptyLabel: string;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="muted mb-1.5 text-xs font-semibold uppercase tracking-wide">{title}</h3>
      {lines.length === 0 ? (
        <div className="muted py-2 text-sm">{emptyLabel}</div>
      ) : (
        lines.map((l) => (
          <div key={l.taxLine} className="flex items-baseline justify-between gap-4 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{l.taxLine}</div>
              <div className="muted truncate text-xs">{l.categories.join(", ")}</div>
            </div>
            <Money cents={l.amountCents} plain className="shrink-0 text-sm" />
          </div>
        ))
      )}
      <div
        className="mt-1 flex items-baseline justify-between gap-4 border-t pt-2.5 text-sm font-semibold"
        style={{ borderColor: "var(--border)" }}
      >
        <span>{subtotalLabel}</span>
        <Money cents={subtotal} plain />
      </div>
    </section>
  );
}
