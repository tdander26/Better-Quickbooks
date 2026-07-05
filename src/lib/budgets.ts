// Budgets — monthly per-category spending targets, compared against actuals.
// A budget's `month` is the "YYYY-MM" key; amounts are integer cents. Actual
// spend comes from the reports engine (spendingByCategory), which returns
// positive magnitudes for EXPENSE categories only. We only budget expenses.
import { prisma } from "@/lib/db";
import { spendingByCategory } from "@/lib/reports";
import { startOfMonth, endOfMonth, parse, format } from "date-fns";

/** "YYYY-MM" key for a date (the identifier a Budget row is stored under). */
export function monthKey(d: Date): string {
  return format(d, "yyyy-MM");
}

/** Parse a "YYYY-MM" key to its inclusive [start, end] date range. */
export function monthRange(month: string): { start: Date; end: Date } {
  const d = parse(month, "yyyy-MM", new Date());
  const base = isNaN(d.getTime()) ? new Date() : d;
  return { start: startOfMonth(base), end: endOfMonth(base) };
}

/** All budgets for a given month, with their category joined. */
export async function getBudgets(month: string) {
  return prisma.budget.findMany({
    where: { month },
    include: { category: true },
    orderBy: { amountCents: "desc" },
  });
}

export interface BudgetLine {
  categoryId: string;
  name: string;
  icon: string;
  budgetCents: number; // 0 when no budget set
  actualCents: number; // spent this month (positive magnitude)
}

export interface BudgetVsActual {
  month: string;
  lines: BudgetLine[];
  totalBudget: number;
  totalActual: number;
}

/**
 * Per expense-category budget vs. actual for a month. Includes any expense
 * category that has a budget OR recorded spend this month. Uncategorized spend
 * (no categoryId) can't be budgeted, so it's excluded from the per-category list.
 */
export async function budgetVsActual(month: string): Promise<BudgetVsActual> {
  const { start, end } = monthRange(month);

  const [categories, budgets, spending] = await Promise.all([
    prisma.category.findMany({ where: { section: "expense" } }),
    getBudgets(month),
    spendingByCategory(start, end),
  ]);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const budgetByCat = new Map(budgets.map((b) => [b.categoryId, b.amountCents]));
  const actualByCat = new Map<string, number>();
  for (const line of spending) {
    if (line.categoryId) actualByCat.set(line.categoryId, line.amountCents);
  }

  // Union of category ids that have a budget or actual spend.
  const ids = new Set<string>([...budgetByCat.keys(), ...actualByCat.keys()]);

  const lines: BudgetLine[] = [];
  for (const id of ids) {
    const cat = catById.get(id);
    // Skip ids that aren't (or no longer are) expense categories.
    if (!cat) continue;
    lines.push({
      categoryId: id,
      name: cat.name,
      icon: cat.icon,
      budgetCents: budgetByCat.get(id) ?? 0,
      actualCents: actualByCat.get(id) ?? 0,
    });
  }

  // Highest activity first: sort by the larger of budget/actual, then name.
  lines.sort((a, b) => {
    const am = Math.max(a.budgetCents, a.actualCents);
    const bm = Math.max(b.budgetCents, b.actualCents);
    if (bm !== am) return bm - am;
    return a.name.localeCompare(b.name);
  });

  const totalBudget = lines.reduce((n, l) => n + l.budgetCents, 0);
  const totalActual = lines.reduce((n, l) => n + l.actualCents, 0);

  return { month, lines, totalBudget, totalActual };
}
