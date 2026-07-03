import { describe, it, expect } from "vitest";
import { categorize, matchRule, type RuleLike, type TxnContext } from "./categorize";

function rule(partial: Partial<RuleLike>): RuleLike {
  return {
    id: "r",
    enabled: true,
    priority: 100,
    matchField: "payee",
    operator: "contains",
    value: "",
    categoryId: "cat",
    markTransfer: false,
    ...partial,
  };
}

function ctx(partial: Partial<TxnContext>): TxnContext {
  return {
    payee: "",
    description: "",
    amountCents: 0,
    institution: "Chase",
    accountName: "Checking",
    ...partial,
  };
}

describe("matchRule — string operators", () => {
  it("contains is case-insensitive", () => {
    expect(matchRule(rule({ operator: "contains", value: "amazon" }), ctx({ payee: "AMAZON.COM" }))).toBe(true);
  });
  it("starts_with / ends_with", () => {
    expect(matchRule(rule({ operator: "starts_with", value: "star" }), ctx({ payee: "Starbucks" }))).toBe(true);
    expect(matchRule(rule({ operator: "ends_with", value: "bucks" }), ctx({ payee: "Starbucks" }))).toBe(true);
  });
  it("equals is exact (case-insensitive)", () => {
    expect(matchRule(rule({ operator: "equals", value: "shell" }), ctx({ payee: "Shell" }))).toBe(true);
    expect(matchRule(rule({ operator: "equals", value: "shell" }), ctx({ payee: "Shell Oil" }))).toBe(false);
  });
  it("regex matches against the description field", () => {
    const r = rule({ matchField: "description", operator: "regex", value: "eftps|irs" });
    expect(matchRule(r, ctx({ description: "GUSTO TAX EFTPS" }))).toBe(true);
  });
  it("invalid regex fails closed (no throw)", () => {
    const r = rule({ matchField: "description", operator: "regex", value: "(" });
    expect(matchRule(r, ctx({ description: "anything" }))).toBe(false);
  });
});

describe("matchRule — amount operators (magnitude)", () => {
  it("gt/lt compare on absolute dollars", () => {
    // outflow of $150 -> -15000 cents; rule value in dollars
    expect(matchRule(rule({ matchField: "amount", operator: "gt", value: "100" }), ctx({ amountCents: -15000 }))).toBe(true);
    expect(matchRule(rule({ matchField: "amount", operator: "lt", value: "100" }), ctx({ amountCents: -15000 }))).toBe(false);
  });
});

describe("categorize — priority ordering & fallthrough", () => {
  const rules: RuleLike[] = [
    rule({ id: "transfer", priority: 10, matchField: "description", operator: "contains", value: "online transfer", categoryId: "cat-transfer", markTransfer: true }),
    rule({ id: "amazon", priority: 60, operator: "contains", value: "amazon", categoryId: "cat-office" }),
    rule({ id: "disabled", priority: 5, operator: "contains", value: "amazon", categoryId: "cat-should-not-win", enabled: false }),
  ];

  it("lowest-priority enabled rule wins", () => {
    const res = categorize(ctx({ payee: "AMAZON.COM", description: "AMAZON MARKETPLACE" }), rules);
    expect(res?.categoryId).toBe("cat-office");
  });
  it("disabled rules are skipped even at lower priority", () => {
    const res = categorize(ctx({ payee: "amazon" }), rules);
    expect(res?.ruleId).not.toBe("disabled");
  });
  it("markTransfer flag surfaces", () => {
    const res = categorize(ctx({ description: "ONLINE TRANSFER TO ALLY" }), rules);
    expect(res?.markTransfer).toBe(true);
  });
  it("returns null when nothing matches", () => {
    expect(categorize(ctx({ payee: "Menards" }), rules)).toBeNull();
  });
});
