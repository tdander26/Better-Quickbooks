// Rules engine. Transactions are matched against enabled rules ordered by
// priority (lower first); the first match assigns the category (and may flag the
// txn as an internal transfer). No match -> caller falls back to "Uncategorized".
//
// Pure functions here so they're trivially unit-testable and reusable both on
// import and from the "Re-apply rules" action.

import type { MatchField, Operator } from "@/lib/types";
import { toCents } from "@/lib/money";

export interface RuleLike {
  id: string;
  enabled: boolean;
  priority: number;
  matchField: string; // MatchField
  operator: string; // Operator
  value: string;
  categoryId: string;
  markTransfer: boolean;
}

export interface TxnContext {
  payee: string;
  description: string;
  amountCents: number;
  institution: string;
  accountName: string;
}

export interface CategorizeResult {
  categoryId: string;
  markTransfer: boolean;
  ruleId: string;
}

function fieldValue(field: MatchField, ctx: TxnContext): string {
  switch (field) {
    case "payee":
      return ctx.payee;
    case "description":
      return ctx.description;
    case "account":
      return `${ctx.institution} ${ctx.accountName}`;
    case "amount":
      return String(ctx.amountCents);
    default:
      return "";
  }
}

function matchString(op: Operator, haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  switch (op) {
    case "contains":
      return h.includes(n);
    case "equals":
      return h === n;
    case "starts_with":
      return h.startsWith(n);
    case "ends_with":
      return h.endsWith(n);
    case "regex":
      try {
        return new RegExp(needle, "i").test(haystack);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function matchAmount(op: Operator, amountCents: number, value: string): boolean {
  const target = toCents(value);
  // Amount comparisons operate on the magnitude so users can write "> 100"
  // without worrying about SimpleFIN's outflow sign.
  const abs = Math.abs(amountCents);
  switch (op) {
    case "gt":
      return abs > target;
    case "lt":
      return abs < target;
    case "equals":
      return abs === Math.abs(target);
    default:
      return false;
  }
}

/** Does a single rule match this transaction? */
export function matchRule(rule: RuleLike, ctx: TxnContext): boolean {
  if (!rule.enabled) return false;
  const field = rule.matchField as MatchField;
  const op = rule.operator as Operator;
  if (field === "amount") {
    return matchAmount(op, ctx.amountCents, rule.value);
  }
  return matchString(op, fieldValue(field, ctx), rule.value);
}

/** Return the first matching rule's assignment, or null if nothing matches. */
export function categorize(ctx: TxnContext, rules: RuleLike[]): CategorizeResult | null {
  const sorted = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (matchRule(rule, ctx)) {
      return { categoryId: rule.categoryId, markTransfer: rule.markTransfer, ruleId: rule.id };
    }
  }
  return null;
}
