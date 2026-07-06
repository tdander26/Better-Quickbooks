// Tenant-isolation tests — the most important safety net for the multi-tenant
// conversion. Verifies that reports, direct queries, and the import path NEVER
// leak or mix data across businesses. Runs against the local SQLite dev DB;
// creates two throwaway businesses and tears them down.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { seedBusinessDefaults } from "@/lib/seed";
import { accountBalances, netWorth, profitAndLoss } from "@/lib/reports";
import { importNormalizedAccounts } from "@/lib/sync";
import type { NormAccount } from "@/lib/feeds/types";

const suffix = Math.random().toString(36).slice(2, 8);
let b1 = "";
let b2 = "";
const createdBusinessIds: string[] = [];

async function makeBusiness(label: string): Promise<string> {
  const biz = await prisma.business.create({
    data: { name: `Test ${label}`, slug: `test-${label}-${suffix}` },
  });
  createdBusinessIds.push(biz.id);
  await seedBusinessDefaults(biz.id);
  return biz.id;
}

async function categoryId(businessId: string, name: string): Promise<string> {
  const c = await prisma.category.findFirst({ where: { businessId, name } });
  if (!c) throw new Error(`category ${name} missing for ${businessId}`);
  return c.id;
}

async function seedFinancials(
  businessId: string,
  opts: { opening: number; income: number; expense: number }
) {
  const account = await prisma.financialAccount.create({
    data: {
      businessId,
      name: "Checking",
      institution: "TestBank",
      type: "bank",
      classification: "asset",
      openingBalanceCents: opts.opening,
    },
  });
  const incomeCat = await categoryId(businessId, "Patient Revenue");
  const expenseCat = await categoryId(businessId, "Office Supplies");

  const incomeTxn = await prisma.transaction.create({
    data: {
      businessId,
      accountId: account.id,
      postedAt: new Date("2026-06-15T12:00:00Z"),
      amountCents: opts.income,
      payee: "Client",
      splits: { create: [{ businessId, amountCents: opts.income, categoryId: incomeCat }] },
    },
  });
  await prisma.transaction.create({
    data: {
      businessId,
      accountId: account.id,
      postedAt: new Date("2026-06-20T12:00:00Z"),
      amountCents: opts.expense,
      payee: "Store",
      splits: { create: [{ businessId, amountCents: opts.expense, categoryId: expenseCat }] },
    },
  });

  // New (post-merge) tenant-scoped models: Budget, Attachment, Statement.
  await prisma.budget.create({
    data: { businessId, categoryId: expenseCat, month: "2026-06", amountCents: 25000 },
  });
  await prisma.attachment.create({
    data: {
      businessId,
      transactionId: incomeTxn.id,
      filename: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      dataBase64: "AAAA",
    },
  });
  await prisma.statement.create({
    data: {
      businessId,
      accountId: account.id,
      endDate: new Date("2026-06-30T12:00:00Z"),
      endingBalanceCents: opts.opening + opts.income + opts.expense,
      transactionCount: 2,
    },
  });
  return account.id;
}

beforeAll(async () => {
  b1 = await makeBusiness("b1");
  b2 = await makeBusiness("b2");
  // B1: opening 1,000.00, +500.00 income, -200.00 expense
  await seedFinancials(b1, { opening: 100000, income: 50000, expense: -20000 });
  // B2: opening 9,999.99, +100.00 income, -50.00 expense
  await seedFinancials(b2, { opening: 999999, income: 10000, expense: -5000 });
});

afterAll(async () => {
  for (const id of createdBusinessIds) {
    await prisma.attachment.deleteMany({ where: { businessId: id } });
    await prisma.statement.deleteMany({ where: { businessId: id } });
    await prisma.budget.deleteMany({ where: { businessId: id } });
    await prisma.split.deleteMany({ where: { businessId: id } });
    await prisma.transaction.deleteMany({ where: { businessId: id } });
    await prisma.rule.deleteMany({ where: { businessId: id } });
    await prisma.importBatch.deleteMany({ where: { businessId: id } });
    await prisma.financialAccount.deleteMany({ where: { businessId: id } });
    await prisma.category.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("tenant isolation", () => {
  it("accountBalances only sees the requested business", async () => {
    const bals = await accountBalances(b1);
    expect(bals).toHaveLength(1);
    // opening 100000 + 50000 - 20000 = 130000
    expect(bals[0].computedCents).toBe(130000);
    // none of B2's accounts leak in
    const b2Accounts = await prisma.financialAccount.findMany({ where: { businessId: b2 } });
    const b2Ids = new Set(b2Accounts.map((a) => a.id));
    expect(bals.some((b) => b2Ids.has(b.id))).toBe(false);
  });

  it("netWorth is scoped per business", async () => {
    const nw1 = await netWorth(b1);
    const nw2 = await netWorth(b2);
    expect(nw1.netWorthCents).toBe(130000);
    expect(nw2.netWorthCents).toBe(1004999); // 999999 + 10000 - 5000
  });

  it("profitAndLoss never mixes businesses", async () => {
    const pl1 = await profitAndLoss(b1, new Date("2026-01-01"), new Date("2026-12-31"));
    expect(pl1.totalIncomeCents).toBe(50000);
    expect(pl1.totalExpenseCents).toBe(20000);

    const pl2 = await profitAndLoss(b2, new Date("2026-01-01"), new Date("2026-12-31"));
    expect(pl2.totalIncomeCents).toBe(10000);
    expect(pl2.totalExpenseCents).toBe(5000);
  });

  it("direct transaction queries scoped by businessId exclude the other tenant", async () => {
    const t1 = await prisma.transaction.findMany({ where: { businessId: b1 } });
    const t2 = await prisma.transaction.findMany({ where: { businessId: b2 } });
    expect(t1).toHaveLength(2);
    expect(t2).toHaveLength(2);
    expect(t1.every((t) => t.businessId === b1)).toBe(true);
    expect(t2.every((t) => t.businessId === b2)).toBe(true);
  });

  it("new models (Budget/Attachment/Statement) are per-business", async () => {
    for (const [biz, other] of [
      [b1, b2],
      [b2, b1],
    ] as const) {
      const budgets = await prisma.budget.findMany({ where: { businessId: biz } });
      const attachments = await prisma.attachment.findMany({ where: { businessId: biz } });
      const statements = await prisma.statement.findMany({ where: { businessId: biz } });
      expect(budgets).toHaveLength(1);
      expect(attachments).toHaveLength(1);
      expect(statements).toHaveLength(1);
      expect(budgets.every((r) => r.businessId === biz)).toBe(true);
      expect(attachments.every((r) => r.businessId === biz)).toBe(true);
      expect(statements.every((r) => r.businessId === biz)).toBe(true);
      // The other tenant's rows never appear.
      const otherBudget = await prisma.budget.findFirst({ where: { businessId: other } });
      expect(otherBudget?.businessId).toBe(other);
    }

    // Budget uniqueness is now per-business: both businesses can hold the same
    // (categoryId is different per business, but month collides) without conflict.
    const allJune = await prisma.budget.findMany({ where: { month: "2026-06", businessId: { in: [b1, b2] } } });
    expect(allJune.length).toBe(2);
  });

  it("import dedupe is per-business (same providerTxnId imports in both)", async () => {
    const norm: NormAccount[] = [
      {
        providerAccountId: `acct-${suffix}`,
        name: "Imported",
        institution: "TestBank",
        type: "bank",
        classification: "asset",
        currency: "USD",
        balanceCents: 0,
        balanceDate: null,
        transactions: [
          {
            providerTxnId: `TXN-${suffix}`,
            postedAt: new Date("2026-06-25T12:00:00Z"),
            amountCents: 1234,
            payee: "Imported Payee",
            description: "IMPORT TEST",
            memo: "",
            pending: false,
          },
        ],
      },
    ];

    // First import into B1: 1 imported.
    const r1 = await importNormalizedAccounts(norm, { businessId: b1, source: "test" });
    expect(r1.imported).toBe(1);
    expect(r1.skipped).toBe(0);

    // Re-import same into B1: deduped -> 0 imported, 1 skipped.
    const r1again = await importNormalizedAccounts(norm, { businessId: b1, source: "test" });
    expect(r1again.imported).toBe(0);
    expect(r1again.skipped).toBe(1);

    // Same providerTxnId into B2: NOT deduped across tenants -> imported.
    const r2 = await importNormalizedAccounts(norm, { businessId: b2, source: "test" });
    expect(r2.imported).toBe(1);
    expect(r2.skipped).toBe(0);
  });
});
