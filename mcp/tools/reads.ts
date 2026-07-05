// Read-only MCP tools: accounts, balances, transactions, chart of accounts,
// rules, and the reporting engine. Thin wrappers over src/lib/reports.ts and
// Prisma — no business logic lives here.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  accountBalances,
  netWorth,
  profitAndLoss,
  balanceSheet,
  cashFlow,
  spendingByCategory,
  monthlyTrend,
} from "@/lib/reports";
import { UNCATEGORIZED } from "@/lib/types";
import { ok, err, money, resolveRange } from "../format.js";

const PAGE_SIZE = 50;

function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Mirror of the where-clause builder in src/app/api/transactions/route.ts. */
function buildTxnWhere(f: {
  q?: string;
  account?: string;
  category?: string;
  filter?: string;
  start?: string;
  end?: string;
}): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [];

  const q = (f.q ?? "").trim();
  if (q) {
    and.push({
      OR: [
        { payee: { contains: q } },
        { description: { contains: q } },
        { memo: { contains: q } },
      ],
    });
  }

  if (f.account) and.push({ accountId: f.account });
  if (f.category) and.push({ splits: { some: { categoryId: f.category } } });

  const uncategorizedSplit: Prisma.SplitWhereInput = {
    OR: [{ categoryId: null }, { category: { is: { name: UNCATEGORIZED } } }],
  };
  const filter = f.filter ?? "all";
  if (filter === "uncategorized") {
    and.push({ splits: { some: uncategorizedSplit, every: uncategorizedSplit } });
  } else if (filter === "pending") {
    and.push({ pending: true });
  } else if (filter === "reviewed") {
    and.push({ reviewed: true });
  } else if (filter === "needs_review") {
    and.push({ reviewed: false });
  }

  const start = parseDate(f.start);
  const end = parseDate(f.end);
  if (start || end) {
    let endOfDay: Date | null = null;
    if (end) {
      endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 999);
    }
    and.push({
      postedAt: {
        ...(start ? { gte: start } : {}),
        ...(endOfDay ? { lte: endOfDay } : {}),
      },
    });
  }

  return and.length ? { AND: and } : {};
}

export function registerReadTools(server: McpServer) {
  server.registerTool(
    "list_accounts",
    {
      description:
        "List all active accounts with their computed balance (opening + transactions), the bank-reported balance, and the reconciliation difference.",
      inputSchema: {},
    },
    async () => {
      const balances = await accountBalances();
      return ok(
        balances.map((b) => ({
          id: b.id,
          name: b.name,
          institution: b.institution,
          type: b.type,
          classification: b.classification,
          computed: money(b.computedCents),
          reported: b.reportedCents === null ? null : money(b.reportedCents),
          reconciliationDiff:
            b.reportedCents === null ? null : money(b.computedCents - b.reportedCents),
          balanceDate: b.balanceDate,
        }))
      );
    }
  );

  server.registerTool(
    "get_net_worth",
    {
      description: "Total assets minus liabilities across all accounts.",
      inputSchema: {},
    },
    async () => {
      const nw = await netWorth();
      return ok({
        assets: money(nw.assetsCents),
        liabilities: money(nw.liabilitiesCents),
        netWorth: money(nw.netWorthCents),
      });
    }
  );

  server.registerTool(
    "list_transactions",
    {
      description:
        "Search and page through the transaction register. Supports free-text search, account/category filters, a status filter, and a date range. Returns 50 per page.",
      inputSchema: {
        q: z.string().optional().describe("Free-text search over payee/description/memo"),
        account: z.string().optional().describe("Account id to filter by"),
        category: z.string().optional().describe("Category id to filter by"),
        filter: z
          .enum(["all", "uncategorized", "pending", "reviewed", "needs_review"])
          .optional()
          .describe("Status filter; 'uncategorized' is the needs-attention queue"),
        start: z.string().optional().describe("ISO date, inclusive lower bound on postedAt"),
        end: z.string().optional().describe("ISO date, inclusive upper bound on postedAt"),
        page: z.number().int().positive().optional().describe("1-based page number"),
      },
    },
    async ({ q, account, category, filter, start, end, page }) => {
      const where = buildTxnWhere({ q, account, category, filter, start, end });
      const p = Math.max(1, page ?? 1);
      const [total, txns] = await Promise.all([
        prisma.transaction.count({ where }),
        prisma.transaction.findMany({
          where,
          orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
          include: { account: true, splits: { include: { category: true } } },
          skip: (p - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      return ok({
        total,
        page: p,
        pageSize: PAGE_SIZE,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        transactions: txns.map((t) => ({
          id: t.id,
          postedAt: t.postedAt,
          account: t.account.name,
          payee: t.payee,
          description: t.description,
          amount: money(t.amountCents),
          pending: t.pending,
          reviewed: t.reviewed,
          splits: t.splits.map((s) => ({
            categoryId: s.categoryId,
            category: s.category?.name ?? UNCATEGORIZED,
            amount: money(s.amountCents),
          })),
        })),
      });
    }
  );

  server.registerTool(
    "get_transaction",
    {
      description: "Fetch a single transaction by id, including its account and category splits.",
      inputSchema: { id: z.string().describe("Transaction id") },
    },
    async ({ id }) => {
      const t = await prisma.transaction.findUnique({
        where: { id },
        include: { account: true, splits: { include: { category: true } } },
      });
      if (!t) return err(`No transaction with id ${id}`);
      return ok({
        id: t.id,
        postedAt: t.postedAt,
        account: { id: t.account.id, name: t.account.name },
        payee: t.payee,
        description: t.description,
        memo: t.memo,
        notes: t.notes,
        amount: money(t.amountCents),
        pending: t.pending,
        reviewed: t.reviewed,
        transferId: t.transferId,
        splits: t.splits.map((s) => ({
          id: s.id,
          categoryId: s.categoryId,
          category: s.category?.name ?? UNCATEGORIZED,
          amount: money(s.amountCents),
        })),
      });
    }
  );

  server.registerTool(
    "list_categories",
    {
      description:
        "The chart of accounts. Each category has a section (income/expense/asset/liability/equity/transfer) that determines which report it appears in.",
      inputSchema: {
        section: z
          .enum(["income", "expense", "asset", "liability", "equity", "transfer"])
          .optional()
          .describe("Optional section filter"),
      },
    },
    async ({ section }) => {
      const categories = await prisma.category.findMany({
        where: section ? { section } : undefined,
        orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      });
      return ok(
        categories.map((c) => ({
          id: c.id,
          name: c.name,
          section: c.section,
          parentId: c.parentId,
          isSystem: c.isSystem,
        }))
      );
    }
  );

  server.registerTool(
    "list_rules",
    {
      description:
        "Auto-categorization rules, ordered by priority (lower runs first). First match assigns the category on import and on reapply.",
      inputSchema: {},
    },
    async () => {
      const rules = await prisma.rule.findMany({
        orderBy: { priority: "asc" },
        include: { category: true },
      });
      return ok(
        rules.map((r) => ({
          id: r.id,
          name: r.name,
          priority: r.priority,
          enabled: r.enabled,
          matchField: r.matchField,
          operator: r.operator,
          value: r.value,
          categoryId: r.categoryId,
          category: r.category?.name,
          markTransfer: r.markTransfer,
        }))
      );
    }
  );

  server.registerTool(
    "profit_and_loss",
    {
      description:
        "Profit & Loss for a date range (defaults to the current month). Income and expense lines grouped by category, plus totals and net income.",
      inputSchema: {
        start: z.string().optional().describe("ISO start date (default: start of this month)"),
        end: z.string().optional().describe("ISO end date (default: end of this month)"),
      },
    },
    async ({ start, end }) => {
      const range = resolveRange(start, end);
      const pl = await profitAndLoss(range.start, range.end);
      return ok({
        start: pl.start,
        end: pl.end,
        income: pl.income.map((l) => ({ category: l.category, amount: money(l.amountCents) })),
        expenses: pl.expenses.map((l) => ({ category: l.category, amount: money(l.amountCents) })),
        totalIncome: money(pl.totalIncomeCents),
        totalExpense: money(pl.totalExpenseCents),
        netIncome: money(pl.netIncomeCents),
      });
    }
  );

  server.registerTool(
    "balance_sheet",
    {
      description:
        "Balance Sheet as of now: assets, liabilities, and equity (assets − liabilities).",
      inputSchema: {},
    },
    async () => {
      const bs = await balanceSheet();
      const line = (b: { id: string; name: string; computedCents: number }) => ({
        id: b.id,
        name: b.name,
        balance: money(b.computedCents),
      });
      return ok({
        asOf: bs.asOf,
        assets: bs.assets.map(line),
        liabilities: bs.liabilities.map(line),
        totalAssets: money(bs.totalAssetsCents),
        totalLiabilities: money(bs.totalLiabilitiesCents),
        equity: money(bs.equityCents),
      });
    }
  );

  server.registerTool(
    "cash_flow",
    {
      description:
        "Cash flow for a date range (defaults to the current month): inflows, outflows, and net.",
      inputSchema: {
        start: z.string().optional().describe("ISO start date (default: start of this month)"),
        end: z.string().optional().describe("ISO end date (default: end of this month)"),
      },
    },
    async ({ start, end }) => {
      const range = resolveRange(start, end);
      const cf = await cashFlow(range.start, range.end);
      return ok({
        start: cf.start,
        end: cf.end,
        inflows: cf.inflows.map((l) => ({ category: l.category, amount: money(l.amountCents) })),
        outflows: cf.outflows.map((l) => ({ category: l.category, amount: money(l.amountCents) })),
        net: money(cf.netCents),
      });
    }
  );

  server.registerTool(
    "spending_by_category",
    {
      description:
        "Expense totals grouped by category for a date range (defaults to the current month), largest first.",
      inputSchema: {
        start: z.string().optional().describe("ISO start date (default: start of this month)"),
        end: z.string().optional().describe("ISO end date (default: end of this month)"),
      },
    },
    async ({ start, end }) => {
      const range = resolveRange(start, end);
      const lines = await spendingByCategory(range.start, range.end);
      return ok(lines.map((l) => ({ category: l.category, amount: money(l.amountCents) })));
    }
  );

  server.registerTool(
    "monthly_trend",
    {
      description: "Monthly income/expense/net for the last N months (default 6).",
      inputSchema: {
        months: z.number().int().positive().max(60).optional().describe("How many months (default 6)"),
      },
    },
    async ({ months }) => {
      const points = await monthlyTrend(months ?? 6);
      return ok(
        points.map((p) => ({
          month: p.month,
          key: p.key,
          income: money(p.incomeCents),
          expense: money(p.expenseCents),
          net: money(p.netCents),
        }))
      );
    }
  );
}
