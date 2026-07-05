// Shared transaction write operations, extracted so both the Next.js API routes
// and the MCP server (mcp/server.ts) drive the exact same logic — no duplicated
// business rules, one source of truth.
//
// Money is signed integer cents (positive = inflow, negative = outflow), matching
// the SimpleFIN convention used across the app. A simple transaction has exactly
// one split whose amount equals the transaction amount.

import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { UNCATEGORIZED } from "@/lib/types";

export interface CreateManualTransactionInput {
  accountId: string;
  /** Signed dollar amount (number or string like "12.34" / "-1,620.00"). */
  amount: number | string;
  payee: string;
  description?: string;
  /** ISO date string or Date; defaults to now. */
  postedAt?: string | Date;
  /** Optional explicit category; falls back to Uncategorized. */
  categoryId?: string;
}

/** Thrown for user-correctable validation problems (bad account/category/amount). */
export class TransactionInputError extends Error {
  /** HTTP status the API route should use (400 by default, 404 for not-found). */
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

/**
 * Create a manual transaction with a single split (chosen category or
 * Uncategorized). Choosing a real (non-Uncategorized) category counts as
 * reviewed. Mirrors the behavior of POST /api/transactions.
 */
export async function createManualTransaction(input: CreateManualTransactionInput) {
  const accountId = String(input.accountId ?? "");
  if (!accountId) throw new TransactionInputError("Pick an account");

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new TransactionInputError("That account doesn't exist", 404);

  const payee = String(input.payee ?? "").trim();
  if (!payee) throw new TransactionInputError("Add a payee or description");
  const description = String(input.description ?? "").trim();

  const amountCents = toCents(input.amount ?? 0);
  if (!Number.isFinite(amountCents) || amountCents === 0) {
    throw new TransactionInputError("Enter an amount");
  }

  let postedAt = new Date();
  if (input.postedAt) {
    const parsed = input.postedAt instanceof Date ? input.postedAt : new Date(String(input.postedAt));
    if (isNaN(parsed.getTime())) throw new TransactionInputError("That date isn't valid");
    postedAt = parsed;
  }

  const uncategorized = await prisma.category.findFirst({ where: { name: UNCATEGORIZED } });
  const requestedCategoryId = input.categoryId ? String(input.categoryId) : "";
  let categoryId: string | null = uncategorized?.id ?? null;
  if (requestedCategoryId) {
    const cat = await prisma.category.findUnique({ where: { id: requestedCategoryId } });
    if (!cat) throw new TransactionInputError("That category doesn't exist");
    categoryId = cat.id;
  }

  const reviewed = Boolean(requestedCategoryId && requestedCategoryId !== uncategorized?.id);

  return prisma.transaction.create({
    data: {
      accountId,
      postedAt,
      amountCents,
      payee,
      description,
      reviewed,
      splits: { create: [{ amountCents, categoryId }] },
    },
    include: { account: true, splits: { include: { category: true } } },
  });
}

/**
 * Collapse a transaction to a single split assigned to `categoryId` (or null =
 * Uncategorized) and mark it reviewed — the fast inline-categorize path shared
 * with PATCH /api/transactions/[id]. Returns the updated transaction.
 */
export async function setTransactionCategory(txnId: string, categoryId: string | null) {
  const txn = await prisma.transaction.findUnique({ where: { id: txnId } });
  if (!txn) throw new TransactionInputError("Transaction not found");

  if (categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) throw new TransactionInputError("That category doesn't exist");
  }

  await prisma.$transaction(async (tx) => {
    await tx.split.deleteMany({ where: { transactionId: txn.id } });
    await tx.split.create({
      data: { transactionId: txn.id, categoryId, amountCents: txn.amountCents },
    });
    await tx.transaction.update({ where: { id: txn.id }, data: { reviewed: true } });
  });

  return prisma.transaction.findUnique({
    where: { id: txn.id },
    include: { account: true, splits: { include: { category: true } } },
  });
}
