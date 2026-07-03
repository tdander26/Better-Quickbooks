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
export async function accountBalances(): Promise<AccountBalance[]> {
  const accounts = await prisma.account.findMany({
    where: { archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const sums = await prisma.transaction.groupBy({
    by: ["accountId"],
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

export async function netWorth(): Promise<NetWorth> {
  const balances = await accountBalances();
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

async function splitsInRange(start: Date, end: Date) {
  return prisma.split.findMany({
    where: {
      transaction: { postedAt: { gte: start, lte: end }, account: { archived: false } },
    },
    include: { category: true },
  });
}

/** Profit & Loss for a date range. */
export async function profitAndLoss(start: Date, end: Date): Promise<ProfitAndLoss> {
  const splits = await splitsInRange(start, end);
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
export async function balanceSheet(): Promise<BalanceSheet> {
  const balances = await accountBalances();
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
export async function spendingByCategory(start: Date, end: Date): Promise<ReportLine[]> {
  const pl = await profitAndLoss(start, end);
  return pl.expenses;
}

/** Cash flow: net change grouped by category (income positive, expense negative). */
export async function cashFlow(start: Date, end: Date) {
  const pl = await profitAndLoss(start, end);
  return {
    start,
    end,
    inflows: pl.income,
    outflows: pl.expenses,
    netCents: pl.netIncomeCents,
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
export async function monthlyTrend(months = 6): Promise<MonthPoint[]> {
  const points: MonthPoint[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = subMonths(now, i);
    const start = startOfMonth(d);
    const end = endOfMonth(d);
    const pl = await profitAndLoss(start, end);
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
