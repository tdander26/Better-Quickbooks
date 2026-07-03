// Maps normalized feed data (from any FeedProvider, or CSV) into our database:
//  - upserts accounts by their provider id
//  - dedupes transactions by providerTxnId
//  - runs new transactions through the rules engine (falls back to Uncategorized)
//  - records an ImportBatch for auditability
//
// Used by the SimpleFIN "Refresh" route and the CSV importer.

import { prisma } from "@/lib/db";
import { categorize, type RuleLike } from "@/lib/categorize";
import { UNCATEGORIZED, TRANSFER_CATEGORY } from "@/lib/types";
import type { NormAccount } from "@/lib/feeds/types";

export interface ImportSummary {
  batchId: string;
  imported: number;
  skipped: number;
  accountsSeen: number;
  errors: string[];
}

async function getRules(): Promise<RuleLike[]> {
  const rules = await prisma.rule.findMany({ where: { enabled: true } });
  return rules.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    priority: r.priority,
    matchField: r.matchField,
    operator: r.operator,
    value: r.value,
    categoryId: r.categoryId,
    markTransfer: r.markTransfer,
  }));
}

async function categoryIdByName(name: string): Promise<string | null> {
  const c = await prisma.category.findFirst({ where: { name } });
  return c?.id ?? null;
}

/** Import normalized accounts + their transactions. */
export async function importNormalizedAccounts(
  accounts: NormAccount[],
  opts: { source: string; connectionId?: string; providerErrors?: string[] }
): Promise<ImportSummary> {
  const rules = await getRules();
  const uncategorizedId = await categoryIdByName(UNCATEGORIZED);
  const transferId = await categoryIdByName(TRANSFER_CATEGORY);

  const batch = await prisma.importBatch.create({
    data: { source: opts.source, note: `${accounts.length} account(s)` },
  });

  let imported = 0;
  let skipped = 0;

  for (const acct of accounts) {
    // Upsert the account by its provider id (or create a fresh one).
    let dbAccount = acct.providerAccountId
      ? await prisma.account.findUnique({ where: { simplefinAccountId: acct.providerAccountId } })
      : null;

    if (!dbAccount) {
      dbAccount = await prisma.account.create({
        data: {
          name: acct.name,
          institution: acct.institution,
          type: acct.type,
          classification: acct.classification,
          currency: acct.currency,
          reportedBalanceCents: acct.balanceCents,
          balanceDate: acct.balanceDate,
          simplefinAccountId: acct.providerAccountId || null,
          connectionId: opts.connectionId,
        },
      });
    } else {
      await prisma.account.update({
        where: { id: dbAccount.id },
        data: {
          reportedBalanceCents: acct.balanceCents,
          balanceDate: acct.balanceDate,
          connectionId: opts.connectionId ?? dbAccount.connectionId,
        },
      });
    }

    for (const txn of acct.transactions) {
      // Dedupe: skip transactions we've already imported.
      if (txn.providerTxnId) {
        const existing = await prisma.transaction.findUnique({
          where: { providerTxnId: txn.providerTxnId },
        });
        if (existing) {
          skipped++;
          continue;
        }
      }

      const ctx = {
        payee: txn.payee || txn.description,
        description: txn.description,
        amountCents: txn.amountCents,
        institution: acct.institution,
        accountName: acct.name,
      };
      const match = categorize(ctx, rules);
      const splitCategoryId = match
        ? match.markTransfer
          ? transferId ?? match.categoryId
          : match.categoryId
        : uncategorizedId;

      await prisma.transaction.create({
        data: {
          accountId: dbAccount.id,
          postedAt: txn.postedAt,
          amountCents: txn.amountCents,
          payee: txn.payee || txn.description,
          description: txn.description,
          memo: txn.memo,
          pending: txn.pending,
          providerTxnId: txn.providerTxnId || null,
          importBatchId: batch.id,
          splits: {
            create: [{ amountCents: txn.amountCents, categoryId: splitCategoryId }],
          },
        },
      });
      imported++;
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { imported, skipped },
  });

  return {
    batchId: batch.id,
    imported,
    skipped,
    accountsSeen: accounts.length,
    errors: opts.providerErrors ?? [],
  };
}

/**
 * Re-run rules across transactions that are still Uncategorized and not yet
 * user-reviewed. Never overwrites a split the user has confirmed.
 */
export async function reapplyRules(): Promise<{ updated: number }> {
  const rules = await getRules();
  const uncategorizedId = await categoryIdByName(UNCATEGORIZED);
  const transferId = await categoryIdByName(TRANSFER_CATEGORY);

  const candidates = await prisma.transaction.findMany({
    where: { reviewed: false, splits: { some: { OR: [{ categoryId: null }, { categoryId: uncategorizedId }] } } },
    include: { splits: true, account: true },
  });

  let updated = 0;
  for (const txn of candidates) {
    // Only auto-recategorize simple (single-split) transactions.
    if (txn.splits.length !== 1) continue;
    const ctx = {
      payee: txn.payee || txn.description,
      description: txn.description,
      amountCents: txn.amountCents,
      institution: txn.account.institution,
      accountName: txn.account.name,
    };
    const match = categorize(ctx, rules);
    if (!match) continue;
    const categoryId = match.markTransfer ? transferId ?? match.categoryId : match.categoryId;
    await prisma.split.update({ where: { id: txn.splits[0].id }, data: { categoryId } });
    updated++;
  }
  return { updated };
}
