// Normalized shapes every feed provider maps into, plus the pluggable
// FeedProvider interface. SimpleFIN is the only implementation in v1; Teller (or
// any other) can be added by implementing this interface and registering it in
// ./index.ts — nothing else in the app needs to change.

import type { AccountType, AccountClass } from "@/lib/types";

export interface NormTxn {
  providerTxnId: string;
  postedAt: Date;
  amountCents: number; // signed: inflow positive, outflow negative (SimpleFIN convention)
  payee: string;
  description: string;
  memo: string;
  pending: boolean;
}

export interface NormAccount {
  providerAccountId: string;
  name: string;
  institution: string; // "Chase", "Ally", ... (from provider org)
  type: AccountType; // best-guess; user can correct in the UI
  classification: AccountClass;
  currency: string;
  balanceCents: number;
  balanceDate: Date | null; // provider's true as-of date
  transactions: NormTxn[];
}

export interface FetchResult {
  accounts: NormAccount[];
  errors: string[];
}

export interface FetchOptions {
  /** Pull transactions posted on/after this date. */
  startDate?: Date;
  /** Include pending transactions. */
  pending?: boolean;
  /** Only fetch balances (skip transactions) — fast health check. */
  balancesOnly?: boolean;
}

export interface FeedProvider {
  readonly id: string; // "simplefin" | "teller"
  /**
   * Exchange a one-time setup token for a long-lived, credential-bearing access
   * URL/secret. Called once when the user connects.
   */
  claim(setupToken: string): Promise<string>;
  /** Fetch accounts (and their transactions) using the stored access secret. */
  fetch(accessUrl: string, opts?: FetchOptions): Promise<FetchResult>;
}
