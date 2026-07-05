// Recurring-series detection. Pure and unit-testable (no DB, no I/O): given a
// flat list of transactions it groups them by a normalized payee and returns
// the ones that recur (>= 3 occurrences) as "series", each annotated with a
// cadence, average amount, and a projected next-expected date.
//
// Money stays in integer cents throughout. Dates are real Date objects.

/** One transaction fed into detection. */
export type SeriesInput = {
  id: string;
  payee: string;
  amountCents: number; // + inflow, - outflow (SimpleFIN convention)
  postedAt: Date;
  categoryName?: string | null;
};

export type Cadence = "Weekly" | "Biweekly" | "Monthly" | "Irregular";

/** A detected recurring series (one normalized payee with >= 3 transactions). */
export type Series = {
  key: string; // normalized payee (grouping key)
  displayPayee: string; // most representative original payee label
  count: number;
  categoryName: string | null; // most common category across the series
  avgAmountCents: number; // rounded average (sign preserved: - for expenses)
  medianGapDays: number; // median of sorted day-gaps between occurrences
  cadence: Cadence;
  firstDate: Date;
  lastDate: Date;
  nextExpectedDate: Date; // lastDate + medianGapDays
};

/** Minimum occurrences before a payee is considered "recurring". */
const MIN_OCCURRENCES = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Normalize a payee for grouping: trim, lowercase, collapse whitespace, and
 * strip trailing store/location numbers such as "#442" or a bare " 442".
 */
export function normalizePayee(payee: string): string {
  return payee
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    // trailing "#442", "# 442" or a bare trailing " 442" (2+ digit store code)
    .replace(/\s*#\s*\d+\s*$/, "")
    .replace(/\s+\d{2,}\s*$/, "")
    .trim();
}

/** Median of a numeric array (0 for empty). Does not mutate the input. */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Whole-day difference between two dates. */
function dayGap(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

/** Bucket a median gap (in days) into a friendly cadence label. */
function cadenceFor(medianGapDays: number): Cadence {
  if (medianGapDays >= 5 && medianGapDays <= 9) return "Weekly";
  if (medianGapDays >= 12 && medianGapDays <= 16) return "Biweekly";
  if (medianGapDays >= 26 && medianGapDays <= 34) return "Monthly";
  return "Irregular";
}

/** Pick the most frequent non-empty value; ties broken by first-seen order. */
function mostCommon(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (!counts.has(v)) order.push(v);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const v of order) {
    const c = counts.get(v)!;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Detect recurring series from a flat transaction list.
 *
 * Groups by normalized payee, keeps groups with >= 3 transactions, and computes
 * per-series stats. Result is sorted by nextExpectedDate ascending (soonest /
 * most overdue first).
 */
export function detectSeries(txns: SeriesInput[]): Series[] {
  const groups = new Map<string, SeriesInput[]>();
  for (const t of txns) {
    const key = normalizePayee(t.payee);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(t);
    else groups.set(key, [t]);
  }

  const series: Series[] = [];

  for (const [key, items] of groups) {
    if (items.length < MIN_OCCURRENCES) continue;

    // Chronological order for gaps / first / last.
    const sorted = [...items].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(dayGap(sorted[i - 1].postedAt, sorted[i].postedAt));
    }
    const medianGapDays = Math.round(median(gaps));

    const firstDate = sorted[0].postedAt;
    const lastDate = sorted[sorted.length - 1].postedAt;

    const totalCents = sorted.reduce((sum, t) => sum + t.amountCents, 0);
    const avgAmountCents = Math.round(totalCents / sorted.length);

    const nextExpectedDate = new Date(lastDate.getTime() + medianGapDays * MS_PER_DAY);

    series.push({
      key,
      displayPayee: mostCommon(sorted.map((t) => t.payee.trim())) ?? sorted[0].payee.trim(),
      count: sorted.length,
      categoryName: mostCommon(sorted.map((t) => t.categoryName)),
      avgAmountCents,
      medianGapDays,
      cadence: cadenceFor(medianGapDays),
      firstDate,
      lastDate,
      nextExpectedDate,
    });
  }

  series.sort((a, b) => a.nextExpectedDate.getTime() - b.nextExpectedDate.getTime());
  return series;
}
