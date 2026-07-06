// Maps normalized feed data (from any FeedProvider, or CSV) into our database:
//  - upserts accounts by their provider id
//  - dedupes transactions by providerTxnId
//  - runs new transactions through the rules engine, PERSISTING provenance
//    (which rule matched + categorizedBy) so the UI can show smart badges
//  - auto-links internal transfers
//  - records an ImportBatch for auditability
//
// Used by the SimpleFIN "Refresh" route and the CSV importer.

import { prisma } from "@/lib/db";
import { categorize, type RuleLike } from "@/lib/categorize";
import { UNCATEGORIZED, TRANSFER_CATEGORY } from "@/lib/types";
import { linkTransfers } from "@/lib/transfers";
import type { NormAccount } from "@/lib/feeds/types";

export interface ImportSummary {
  batchId: string;
  imported: number;
  skipped: number;
  accountsSeen: number;
  transfersLinked: number;
  errors: string[];
}

export async function loadEnabledRules(businessId: string): Promise<RuleLike[]> {
  const rules = await prisma.rule.findMany({ where: { businessId, enabled: true } });
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

async function categoryIdByName(businessId: string, name: string): Promise<string | null> {
  const c = await prisma.category.findFirst({ where: { businessId, name } });
  return c?.id ?? null;
}

/** Bump matchCount/lastMatchedAt for each rule that fired (scoped to a business). */
async function recordRuleHits(businessId: string, hits: Map<string, number>): Promise<void> {
  const now = new Date();
  for (const [ruleId, count] of hits) {
    await prisma.rule.updateMany({
      where: { id: ruleId, businessId },
      data: { matchCount: { increment: count }, lastMatchedAt: now },
    });
  }
}

/** Import normalized accounts + their transactions (scoped to one business). */
export async function importNormalizedAccounts(
  accounts: NormAccount[],
  opts: { businessId: string; source: string; connectionId?: string; providerErrors?: string[] }
): Promise<ImportSummary> {
  const { businessId } = opts;
  const rules = await loadEnabledRules(businessId);
  const uncategorizedId = await categoryIdByName(businessId, UNCATEGORIZED);
  const transferId = await categoryIdByName(businessId, TRANSFER_CATEGORY);

  const batch = await prisma.importBatch.create({
    data: { businessId, source: opts.source, note: `${accounts.length} account(s)` },
  });

  let imported = 0;
  let skipped = 0;
  const ruleHits = new Map<string, number>();

  for (const acct of accounts) {
    // Upsert the account by its provider id (or create a fresh one), scoped to
    // this business.
    let dbAccount = acct.providerAccountId
      ? await prisma.financialAccount.findFirst({
          where: { businessId, simplefinAccountId: acct.providerAccountId },
        })
      : null;

    if (!dbAccount) {
      dbAccount = await prisma.financialAccount.create({
        data: {
          businessId,
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
      await prisma.financialAccount.update({
        where: { id: dbAccount.id },
        data: {
          reportedBalanceCents: acct.balanceCents,
          balanceDate: acct.balanceDate,
          connectionId: opts.connectionId ?? dbAccount.connectionId,
        },
      });
    }

    for (const txn of acct.transactions) {
      // Dedupe: skip transactions we've already imported (per business).
      if (txn.providerTxnId) {
        const existing = await prisma.transaction.findFirst({
          where: { businessId, providerTxnId: txn.providerTxnId },
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
      if (match) ruleHits.set(match.ruleId, (ruleHits.get(match.ruleId) ?? 0) + 1);

      await prisma.transaction.create({
        data: {
          businessId,
          accountId: dbAccount.id,
          postedAt: txn.postedAt,
          amountCents: txn.amountCents,
          payee: txn.payee || txn.description,
          description: txn.description,
          memo: txn.memo,
          pending: txn.pending,
          providerTxnId: txn.providerTxnId || null,
          importBatchId: batch.id,
          categorizedBy: match ? "rule" : null,
          splits: {
            create: [
              {
                businessId,
                amountCents: txn.amountCents,
                categoryId: splitCategoryId,
                matchedRuleId: match?.ruleId ?? null,
              },
            ],
          },
        },
      });
      imported++;
    }
  }

  await recordRuleHits(businessId, ruleHits);
  const { linked } = await linkTransfers(businessId);

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { imported, skipped },
  });

  return {
    batchId: batch.id,
    imported,
    skipped,
    accountsSeen: accounts.length,
    transfersLinked: linked,
    errors: opts.providerErrors ?? [],
  };
}

/**
 * Re-run rules across transactions that are still Uncategorized OR were
 * previously auto-assigned by a rule (categorizedBy="rule") and not yet
 * user-reviewed. Never overwrites a split the user confirmed. Persists
 * provenance and refreshes rule stats + transfer links.
 */
export async function reapplyRules(businessId: string): Promise<{ updated: number; transfersLinked: number }> {
  const rules = await loadEnabledRules(businessId);
  const uncategorizedId = await categoryIdByName(businessId, UNCATEGORIZED);
  const transferId = await categoryIdByName(businessId, TRANSFER_CATEGORY);

  const candidates = await prisma.transaction.findMany({
    where: {
      businessId,
      reviewed: false,
      OR: [
        { splits: { some: { OR: [{ categoryId: null }, { categoryId: uncategorizedId }] } } },
        { categorizedBy: "rule" },
      ],
    },
    include: { splits: true, account: true },
  });

  let updated = 0;
  const ruleHits = new Map<string, number>();

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
    await prisma.split.update({
      where: { id: txn.splits[0].id },
      data: { categoryId, matchedRuleId: match.ruleId },
    });
    await prisma.transaction.update({ where: { id: txn.id }, data: { categorizedBy: "rule" } });
    ruleHits.set(match.ruleId, (ruleHits.get(match.ruleId) ?? 0) + 1);
    updated++;
  }

  await recordRuleHits(businessId, ruleHits);
  const { linked } = await linkTransfers(businessId);
  return { updated, transfersLinked: linked };
}
