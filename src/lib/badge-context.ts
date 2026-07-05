// Server-side builder for the cross-transaction context the badge logic needs:
// which payees recur, which transactions look like duplicates, which transfers
// are fully linked, and rule id -> name. Computed once per page render.
import { prisma } from "@/lib/db";
import type { BadgeContext } from "@/lib/badges";

interface PageTxn {
  id: string;
  accountId: string;
  amountCents: number;
  postedAt: Date;
  transferId: string | null;
}

const DAY = 86_400_000;

export async function buildBadgeContext(pageTxns: PageTxn[]): Promise<BadgeContext> {
  const [rules, grouped] = await Promise.all([
    prisma.rule.findMany({ select: { id: true, name: true } }),
    // A payee seen 3+ times is treated as recurring (rent, payroll, subscriptions…).
    prisma.transaction.groupBy({
      by: ["payee"],
      where: { payee: { not: "" } },
      _count: { _all: true },
    }),
  ]);

  const ruleNameById = Object.fromEntries(rules.map((r) => [r.id, r.name]));
  const recurringPayees = new Set(
    grouped.filter((g) => g._count._all >= 3).map((g) => g.payee.trim().toLowerCase())
  );

  // Transfers with both sides present (so we can distinguish linked vs unmatched).
  const transferIds = [...new Set(pageTxns.map((t) => t.transferId).filter(Boolean))] as string[];
  const transferLinked = new Set<string>();
  if (transferIds.length) {
    const counts = await prisma.transaction.groupBy({
      by: ["transferId"],
      where: { transferId: { in: transferIds } },
      _count: { _all: true },
    });
    for (const c of counts) if (c.transferId && c._count._all >= 2) transferLinked.add(c.transferId);
  }

  // Duplicate detection within the visible page: same account, same (not opposite)
  // amount, within 3 days. Transfers have opposite amounts on different accounts,
  // so they never trip this.
  const duplicateIds = new Set<string>();
  for (let i = 0; i < pageTxns.length; i++) {
    for (let j = i + 1; j < pageTxns.length; j++) {
      const a = pageTxns[i];
      const b = pageTxns[j];
      if (a.accountId !== b.accountId || a.amountCents !== b.amountCents) continue;
      if (Math.abs(a.postedAt.getTime() - b.postedAt.getTime()) > 3 * DAY) continue;
      duplicateIds.add(a.id);
      duplicateIds.add(b.id);
    }
  }

  return { ruleNameById, recurringPayees, transferLinked, duplicateIds };
}
