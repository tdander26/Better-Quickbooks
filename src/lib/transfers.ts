// Internal-transfer auto-linking. A transfer is two transactions in DIFFERENT
// accounts with opposite amounts, posted within a few days of each other, both
// categorized as Transfer. Both sides share one `transferId`. This is the single
// source of truth used by import, the CSV importer, bulk actions, and the seed —
// previously each path linked (or failed to link) differently.

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";

const WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // ±5 days

interface Candidate {
  id: string;
  accountId: string;
  amountCents: number;
  postedAt: Date;
}

function pairUp(candidates: Candidate[]): [string, string][] {
  const used = new Set<string>();
  const pairs: [string, string][] = [];
  // Oldest first for stable pairing.
  const sorted = [...candidates].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  for (const a of sorted) {
    if (used.has(a.id)) continue;
    let best: Candidate | null = null;
    let bestDelta = Infinity;
    for (const b of sorted) {
      if (b.id === a.id || used.has(b.id)) continue;
      if (b.accountId === a.accountId) continue;
      if (b.amountCents !== -a.amountCents) continue;
      const delta = Math.abs(b.postedAt.getTime() - a.postedAt.getTime());
      if (delta > WINDOW_MS) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = b;
      }
    }
    if (best) {
      used.add(a.id);
      used.add(best.id);
      pairs.push([a.id, best.id]);
    }
  }
  return pairs;
}

/**
 * Link unlinked Transfer-categorized transactions into pairs. Optionally scope to
 * a set of transaction ids (e.g. a bulk selection or one import batch). Returns
 * the number of pairs linked.
 */
export async function linkTransfers(scope?: { transactionIds?: string[] }): Promise<{ linked: number }> {
  // Any transfer-SECTION category counts (e.g. "Transfer" AND "Credit Card Payment").
  const candidates = await prisma.transaction.findMany({
    where: {
      transferId: null,
      splits: { some: { category: { is: { section: "transfer" } } } },
      ...(scope?.transactionIds ? { id: { in: scope.transactionIds } } : {}),
    },
    select: { id: true, accountId: true, amountCents: true, postedAt: true },
  });

  const pairs = pairUp(candidates);
  for (const [a, b] of pairs) {
    const tid = randomUUID();
    await prisma.transaction.updateMany({ where: { id: { in: [a, b] } }, data: { transferId: tid } });
  }
  return { linked: pairs.length };
}

/** The counterpart of a linked transfer, if any (for "jump to other side" UI). */
export async function transferCounterpart(transactionId: string) {
  const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!txn?.transferId) return null;
  return prisma.transaction.findFirst({
    where: { transferId: txn.transferId, id: { not: transactionId } },
    include: { account: true },
  });
}
