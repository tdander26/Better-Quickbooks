import { describe, it, expect } from "vitest";
import { transactionBadges, type TxnForBadges, type BadgeContext } from "./badges";

function ctx(over: Partial<BadgeContext> = {}): BadgeContext {
  return {
    ruleNameById: { r1: "Amazon" },
    recurringPayees: new Set<string>(),
    duplicateIds: new Set<string>(),
    transferLinked: new Set<string>(),
    ...over,
  };
}

function txn(over: Partial<TxnForBadges> = {}): TxnForBadges {
  return {
    id: "t1",
    amountCents: -2500,
    payee: "Amazon",
    pending: false,
    reviewed: false,
    transferId: null,
    categorizedBy: "manual",
    splits: [{ matchedRuleId: null, categoryName: "Office Supplies" }],
    ...over,
  };
}

const keys = (b: ReturnType<typeof transactionBadges>) => b.map((x) => x.key);

describe("transactionBadges", () => {
  it("shows Auto + Needs review for an unconfirmed rule match", () => {
    const b = transactionBadges(
      txn({ categorizedBy: "rule", reviewed: false, splits: [{ matchedRuleId: "r1", categoryName: "Office Supplies" }] }),
      ctx()
    );
    expect(keys(b)).toContain("auto");
    expect(keys(b)).toContain("review");
    expect(b.find((x) => x.key === "auto")?.title).toContain("Amazon");
  });

  it("drops Needs review once reviewed", () => {
    const b = transactionBadges(
      txn({ categorizedBy: "rule", reviewed: true, splits: [{ matchedRuleId: "r1", categoryName: "Office Supplies" }] }),
      ctx()
    );
    expect(keys(b)).toContain("auto");
    expect(keys(b)).not.toContain("review");
  });

  it("flags Uncategorized", () => {
    const b = transactionBadges(txn({ splits: [{ matchedRuleId: null, categoryName: "Uncategorized" }] }), ctx());
    expect(keys(b)).toContain("uncategorized");
  });

  it("distinguishes linked vs unmatched transfers", () => {
    const linked = transactionBadges(txn({ transferId: "g1" }), ctx({ transferLinked: new Set(["g1"]) }));
    expect(keys(linked)).toContain("transfer");
    const unmatched = transactionBadges(txn({ transferId: "g2" }), ctx());
    expect(keys(unmatched)).toContain("transfer-unmatched");
  });

  it("adds recurring, duplicate, large, split, pending", () => {
    const b = transactionBadges(
      txn({
        amountCents: -600000, // large ($6,000 > $5,000 threshold)
        pending: true,
        payee: "Rent",
        splits: [
          { matchedRuleId: null, categoryName: "Rent" },
          { matchedRuleId: null, categoryName: "Utilities" },
        ],
      }),
      ctx({ recurringPayees: new Set(["rent"]), duplicateIds: new Set(["t1"]) })
    );
    expect(keys(b)).toEqual(expect.arrayContaining(["pending", "split", "recurring", "duplicate", "large"]));
  });
});
