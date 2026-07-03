// Source-of-truth union types for the string "enum" fields in schema.prisma.
// Kept as const arrays so we get both runtime values (for zod/validation/seeds)
// and compile-time types.

export const ACCOUNT_TYPES = ["bank", "credit_card"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_CLASSES = ["asset", "liability"] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

export const SECTIONS = [
  "income",
  "expense",
  "asset",
  "liability",
  "equity",
  "transfer",
] as const;
export type Section = (typeof SECTIONS)[number];

export const MATCH_FIELDS = ["payee", "description", "amount", "account"] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];

export const OPERATORS = [
  "contains",
  "equals",
  "starts_with",
  "ends_with",
  "regex",
  "gt",
  "lt",
] as const;
export type Operator = (typeof OPERATORS)[number];

export const PROVIDERS = ["simplefin", "teller"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const UNCATEGORIZED = "Uncategorized";
export const TRANSFER_CATEGORY = "Transfer";

// Human-friendly labels for account types.
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank / Checking",
  credit_card: "Credit Card",
};

export const SECTION_LABELS: Record<Section, string> = {
  income: "Income",
  expense: "Expenses",
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  transfer: "Transfers",
};
