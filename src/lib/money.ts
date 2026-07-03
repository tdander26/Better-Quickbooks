// All money is stored as integer cents. These helpers convert to/from dollars
// and format for display. Never use floats for storage or arithmetic on money.

/** Convert a dollar amount (number or string like "12.34" / "-1,620.00") to cents. */
export function toCents(dollars: number | string): number {
  if (typeof dollars === "string") {
    const cleaned = dollars.replace(/[$,\s]/g, "");
    const n = parseFloat(cleaned);
    return Math.round((isNaN(n) ? 0 : n) * 100);
  }
  return Math.round(dollars * 100);
}

/** Convert cents to a dollar number. */
export function toDollars(cents: number): number {
  return cents / 100;
}

/** Format cents as USD, e.g. 123456 -> "$1,234.56", -500 -> "-$5.00". */
export function formatMoney(
  cents: number,
  opts: { showCents?: boolean; signed?: boolean } = {}
): string {
  const { showCents = true, signed = false } = opts;
  const value = cents / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(Math.abs(value));
  const sign = cents < 0 ? "-" : signed ? "+" : "";
  return `${sign}${formatted}`;
}

/** Compact format for charts/tiles, e.g. 1234567 -> "$12.3k". */
export function formatMoneyCompact(cents: number): string {
  const value = cents / 100;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
