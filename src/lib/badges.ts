// Smart transaction badges. Pure logic (no DB) so it's easy to test and reuse
// across the table, mobile cards, and the account register. The server computes
// the cross-transaction context (recurring payees, duplicate ids) once and hands
// it in; per-row badge derivation is cheap.

export type BadgeTone = "brand" | "amber" | "red" | "blue" | "neutral" | "violet";

export interface Badge {
  key: string;
  label: string;
  tone: BadgeTone;
  title: string; // tooltip / accessible description
}

export const LARGE_THRESHOLD_CENTS = 500_000; // $5,000 — flags genuinely notable amounts

export interface TxnForBadges {
  id: string;
  amountCents: number;
  payee: string;
  pending: boolean;
  reviewed: boolean;
  transferId: string | null;
  categorizedBy: string | null; // "rule" | "manual" | "import" | null
  splits: { matchedRuleId: string | null; categoryName: string | null }[];
}

export interface BadgeContext {
  ruleNameById: Record<string, string>;
  recurringPayees: Set<string>; // lowercased payees seen on a recurring cadence
  duplicateIds: Set<string>;
  transferLinked: Set<string>; // transferIds that have both sides present
  uncategorizedName?: string; // defaults to "Uncategorized"
  largeThresholdCents?: number;
}

function isUncategorized(txn: TxnForBadges, uncat: string): boolean {
  return txn.splits.every((s) => !s.categoryName || s.categoryName === uncat);
}

/** Derive the ordered badge list for a transaction. Most important first. */
export function transactionBadges(txn: TxnForBadges, ctx: BadgeContext): Badge[] {
  const uncat = ctx.uncategorizedName ?? "Uncategorized";
  const large = ctx.largeThresholdCents ?? LARGE_THRESHOLD_CENTS;
  const badges: Badge[] = [];

  if (txn.pending) {
    badges.push({ key: "pending", label: "Pending", tone: "amber", title: "The bank hasn't fully posted this yet" });
  }

  if (txn.transferId) {
    const linked = ctx.transferLinked.has(txn.transferId);
    badges.push(
      linked
        ? { key: "transfer", label: "Transfer", tone: "blue", title: "Internal transfer — linked to its other side" }
        : { key: "transfer-unmatched", label: "Transfer?", tone: "amber", title: "Marked as a transfer but the matching side wasn't found" }
    );
  }

  if (isUncategorized(txn, uncat)) {
    badges.push({ key: "uncategorized", label: "Uncategorized", tone: "amber", title: "Needs a category" });
  } else {
    const ruleSplit = txn.splits.find((s) => s.matchedRuleId);
    if (txn.categorizedBy === "rule" && ruleSplit?.matchedRuleId) {
      const ruleName = ctx.ruleNameById[ruleSplit.matchedRuleId];
      badges.push({
        key: "auto",
        label: "Auto",
        tone: "brand",
        title: ruleName ? `Auto-categorized by rule "${ruleName}"` : "Auto-categorized by a rule",
      });
      if (!txn.reviewed) {
        badges.push({ key: "review", label: "Needs review", tone: "violet", title: "Auto-categorized — confirm to lock it in" });
      }
    }
  }

  if (txn.splits.length > 1) {
    badges.push({ key: "split", label: "Split", tone: "neutral", title: `Split across ${txn.splits.length} categories` });
  }

  if (ctx.recurringPayees.has(txn.payee.trim().toLowerCase()) && txn.payee.trim() !== "") {
    badges.push({ key: "recurring", label: "Recurring", tone: "blue", title: "Part of a recurring series (same payee, regular cadence)" });
  }

  if (ctx.duplicateIds.has(txn.id)) {
    badges.push({ key: "duplicate", label: "Possible duplicate", tone: "red", title: "Same account and amount as another transaction within a few days" });
  }

  if (Math.abs(txn.amountCents) >= large) {
    badges.push({ key: "large", label: "Large", tone: "neutral", title: `Over ${(large / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}` });
  }

  return badges;
}
