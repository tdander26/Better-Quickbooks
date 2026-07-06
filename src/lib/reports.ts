// Reporting engine. All figures in integer cents.
//
// Sign conventions (SimpleFIN-native): transaction.amountCents is +inflow /
// -outflow on its account. A category split carries the same-signed portion.
//   - Asset (bank) account balance  = opening + Σ txn amounts  (normally positive)
//   - Liability (card) account balance = opening + Σ txn amounts (negative = owed)
//   - Net worth = Σ all account balances (assets positive + liabilities negative)
//   - Income  = Σ splits in income-section  (inflows, positive)
//   - Expense = Σ splits in expense-section (outflows, negative)
//   - Net income = Income + Expense(negative)
// TRANSFER-section splits are internal movement and excluded from P&L / Cash Flow.

import { prisma } from "@/lib/db";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
} from "date-fns";

export interface AccountBalance {
  id: string;
  name: string;
  institution: string;
  type: string;
  classification: string;
  computedCents: number; // opening + sum(txns)
  reportedCents: number | null; // bank-reported (SimpleFIN)
  balanceDate: Date | null;
}

/** Computed running balance per (non-archived) account. */
export async function accountBalances(businessId: string): Promise<AccountBalance[]> {
  const accounts = await prisma.financialAccount.findMany({
    where: { businessId, archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const sums = await prisma.transaction.groupBy({
    by: ["accountId"],
    where: { businessId },
    _sum: { amountCents: true },
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum.amountCents ?? 0]));

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    institution: a.institution,
    type: a.type,
    classification: a.classification,
    computedCents: a.openingBalanceCents + (sumByAccount.get(a.id) ?? 0),
    reportedCents: a.reportedBalanceCents ?? null,
    balanceDate: a.balanceDate ?? null,
  }));
}

export interface NetWorth {
  assetsCents: number;
  liabilitiesCents: number; // positive magnitude owed
  netWorthCents: number;
}

export async function netWorth(businessId: string): Promise<NetWorth> {
  const balances = await accountBalances(businessId);
  let assets = 0;
  let liabilities = 0;
  for (const b of balances) {
    if (b.classification === "asset") assets += b.computedCents;
    else liabilities += -b.computedCents; // stored negative -> positive owed
  }
  return { assetsCents: assets, liabilitiesCents: liabilities, netWorthCents: assets - liabilities };
}

export interface ReportLine {
  categoryId: string | null;
  category: string;
  amountCents: number; // display magnitude (positive)
}

export interface ProfitAndLoss {
  start: Date;
  end: Date;
  income: ReportLine[];
  expenses: ReportLine[];
  totalIncomeCents: number;
  totalExpenseCents: number;
  netIncomeCents: number;
}

async function splitsInRange(businessId: string, start: Date, end: Date, accountId?: string) {
  return prisma.split.findMany({
    where: {
      businessId,
      transaction: {
        postedAt: { gte: start, lte: end },
        account: { archived: false },
        ...(accountId ? { accountId } : {}),
      },
    },
    include: { category: true },
  });
}

/**
 * Profit & Loss for a date range. Pass `accountId` to restrict the statement to
 * a single account's transactions (splits of other accounts are excluded).
 */
export async function profitAndLoss(
  businessId: string,
  start: Date,
  end: Date,
  accountId?: string
): Promise<ProfitAndLoss> {
  const splits = await splitsInRange(businessId, start, end, accountId);
  const incomeMap = new Map<string, ReportLine>();
  const expenseMap = new Map<string, ReportLine>();

  for (const s of splits) {
    const section = s.category?.section ?? "expense";
    const key = s.categoryId ?? "uncategorized";
    const name = s.category?.name ?? "Uncategorized";
    if (section === "income") {
      const line = incomeMap.get(key) ?? { categoryId: s.categoryId, category: name, amountCents: 0 };
      line.amountCents += s.amountCents; // inflows positive
      incomeMap.set(key, line);
    } else if (section === "expense") {
      const line = expenseMap.get(key) ?? { categoryId: s.categoryId, category: name, amountCents: 0 };
      line.amountCents += -s.amountCents; // outflows negative -> positive magnitude
      expenseMap.set(key, line);
    }
    // asset/liability/equity/transfer splits are not P&L items
  }

  const income = [...incomeMap.values()].sort((a, b) => b.amountCents - a.amountCents);
  const expenses = [...expenseMap.values()].sort((a, b) => b.amountCents - a.amountCents);
  const totalIncomeCents = income.reduce((n, l) => n + l.amountCents, 0);
  const totalExpenseCents = expenses.reduce((n, l) => n + l.amountCents, 0);

  return {
    start,
    end,
    income,
    expenses,
    totalIncomeCents,
    totalExpenseCents,
    netIncomeCents: totalIncomeCents - totalExpenseCents,
  };
}

export interface BalanceSheet {
  asOf: Date;
  assets: AccountBalance[];
  liabilities: AccountBalance[];
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  equityCents: number;
}

/** Balance Sheet as of now (current balances). */
export async function balanceSheet(businessId: string): Promise<BalanceSheet> {
  const balances = await accountBalances(businessId);
  const assets = balances.filter((b) => b.classification === "asset");
  const liabilities = balances.filter((b) => b.classification === "liability");
  const totalAssetsCents = assets.reduce((n, b) => n + b.computedCents, 0);
  const totalLiabilitiesCents = liabilities.reduce((n, b) => n + -b.computedCents, 0);
  return {
    asOf: new Date(),
    assets,
    liabilities,
    totalAssetsCents,
    totalLiabilitiesCents,
    equityCents: totalAssetsCents - totalLiabilitiesCents,
  };
}

/** Spending grouped by expense category for a range (positive magnitudes). */
export async function spendingByCategory(businessId: string, start: Date, end: Date): Promise<ReportLine[]> {
  const pl = await profitAndLoss(businessId, start, end);
  return pl.expenses;
}

/**
 * Cash flow: net change grouped by category (income positive, expense negative).
 * Pass `accountId` to restrict to a single account's transactions.
 */
export async function cashFlow(businessId: string, start: Date, end: Date, accountId?: string) {
  const pl = await profitAndLoss(businessId, start, end, accountId);
  return {
    start,
    end,
    inflows: pl.income,
    outflows: pl.expenses,
    netCents: pl.netIncomeCents,
  };
}

/**
 * Computed running balance per (non-archived) account, counting only
 * transactions posted on/before `asOf`. Used for a point-in-time balance sheet.
 */
export async function accountBalancesAsOf(businessId: string, asOf: Date): Promise<AccountBalance[]> {
  const accounts = await prisma.financialAccount.findMany({
    where: { businessId, archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const sums = await prisma.transaction.groupBy({
    by: ["accountId"],
    where: { businessId, postedAt: { lte: asOf } },
    _sum: { amountCents: true },
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum.amountCents ?? 0]));

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    institution: a.institution,
    type: a.type,
    classification: a.classification,
    computedCents: a.openingBalanceCents + (sumByAccount.get(a.id) ?? 0),
    reportedCents: a.reportedBalanceCents ?? null,
    balanceDate: a.balanceDate ?? null,
  }));
}

/**
 * Balance Sheet as of a specific date: asset / liability / equity positions using
 * only transactions posted on/before `asOf`.
 */
export async function balanceSheetAsOf(businessId: string, asOf: Date): Promise<BalanceSheet> {
  const balances = await accountBalancesAsOf(businessId, asOf);
  const assets = balances.filter((b) => b.classification === "asset");
  const liabilities = balances.filter((b) => b.classification === "liability");
  const totalAssetsCents = assets.reduce((n, b) => n + b.computedCents, 0);
  const totalLiabilitiesCents = liabilities.reduce((n, b) => n + -b.computedCents, 0);
  return {
    asOf,
    assets,
    liabilities,
    totalAssetsCents,
    totalLiabilitiesCents,
    equityCents: totalAssetsCents - totalLiabilitiesCents,
  };
}

export interface MonthlyCategoryRow {
  categoryId: string | null;
  category: string;
  section: "income" | "expense";
  values: Record<string, number>; // month key ("2026-01") -> cents (positive magnitude)
  totalCents: number;
}

export interface MonthlyByCategory {
  months: { key: string; label: string }[]; // chronological, oldest -> newest
  income: MonthlyCategoryRow[];
  expenses: MonthlyCategoryRow[];
  incomeTotals: Record<string, number>; // per-month income subtotal
  expenseTotals: Record<string, number>; // per-month expense subtotal
  netByMonth: Record<string, number>; // per-month net income
  totalIncomeCents: number;
  totalExpenseCents: number;
  netIncomeCents: number;
}

/**
 * Per-category income & expense totals for each of the last N months — the data
 * behind a P&L-by-month grid. Each row carries a value per month key plus a row
 * total; column subtotals and a net-income-by-month row are precomputed.
 */
export async function monthlyByCategory(businessId: string, months = 6): Promise<MonthlyByCategory> {
  const now = new Date();
  const monthDefs = [] as { key: string; label: string; start: Date; end: Date }[];
  for (let i = months - 1; i >= 0; i--) {
    const d = subMonths(now, i);
    monthDefs.push({
      key: format(d, "yyyy-MM"),
      label: format(d, "MMM"),
      start: startOfMonth(d),
      end: endOfMonth(d),
    });
  }

  const incomeMap = new Map<string, MonthlyCategoryRow>();
  const expenseMap = new Map<string, MonthlyCategoryRow>();
  const incomeTotals: Record<string, number> = {};
  const expenseTotals: Record<string, number> = {};
  const netByMonth: Record<string, number> = {};

  const upsert = (
    map: Map<string, MonthlyCategoryRow>,
    section: "income" | "expense",
    line: ReportLine,
    monthKey: string
  ) => {
    const key = line.categoryId ?? "uncategorized";
    const row =
      map.get(key) ??
      ({ categoryId: line.categoryId, category: line.category, section, values: {}, totalCents: 0 } as MonthlyCategoryRow);
    row.values[monthKey] = (row.values[monthKey] ?? 0) + line.amountCents;
    row.totalCents += line.amountCents;
    map.set(key, row);
  };

  for (const m of monthDefs) {
    incomeTotals[m.key] = 0;
    expenseTotals[m.key] = 0;
    const pl = await profitAndLoss(businessId, m.start, m.end);
    for (const l of pl.income) {
      upsert(incomeMap, "income", l, m.key);
      incomeTotals[m.key] += l.amountCents;
    }
    for (const l of pl.expenses) {
      upsert(expenseMap, "expense", l, m.key);
      expenseTotals[m.key] += l.amountCents;
    }
    netByMonth[m.key] = incomeTotals[m.key] - expenseTotals[m.key];
  }

  const income = [...incomeMap.values()].sort((a, b) => b.totalCents - a.totalCents);
  const expenses = [...expenseMap.values()].sort((a, b) => b.totalCents - a.totalCents);
  const totalIncomeCents = income.reduce((n, r) => n + r.totalCents, 0);
  const totalExpenseCents = expenses.reduce((n, r) => n + r.totalCents, 0);

  return {
    months: monthDefs.map((m) => ({ key: m.key, label: m.label })),
    income,
    expenses,
    incomeTotals,
    expenseTotals,
    netByMonth,
    totalIncomeCents,
    totalExpenseCents,
    netIncomeCents: totalIncomeCents - totalExpenseCents,
  };
}

export interface MonthPoint {
  month: string; // "Jan"
  key: string; // "2026-01"
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

/** Monthly income/expense/net for the last N months (for dashboard charts). */
export async function monthlyTrend(businessId: string, months = 6): Promise<MonthPoint[]> {
  const points: MonthPoint[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = subMonths(now, i);
    const start = startOfMonth(d);
    const end = endOfMonth(d);
    const pl = await profitAndLoss(businessId, start, end);
    points.push({
      month: format(d, "MMM"),
      key: format(d, "yyyy-MM"),
      incomeCents: pl.totalIncomeCents,
      expenseCents: pl.totalExpenseCents,
      netCents: pl.netIncomeCents,
    });
  }
  return points;
}
