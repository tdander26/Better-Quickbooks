// SimpleFIN Bridge provider — TypeScript port of the user's proven Apps Script
// (SimpleFin.gs). Protocol:
//   1. The setup token is base64 of a one-time "claim URL". POST to it (empty
//      body) and the response body is the long-lived access URL, of the form
//      https://user:pass@host/path  (credentials embedded).
//   2. GET {access}/accounts?start-date=&end-date=&pending=1 returns accounts,
//      each with balances and a transactions[] array. Timestamps are unix
//      SECONDS. Transaction amounts are strings; OUTFLOWS ARE NEGATIVE.
//   3. Each account carries "balance-date" (unix seconds) = the bank's true
//      as-of date for the balance (not when we fetched).

import type {
  FeedProvider,
  FetchOptions,
  FetchResult,
  NormAccount,
  NormTxn,
} from "./types";
import type { AccountType, AccountClass } from "@/lib/types";
import { toCents } from "@/lib/money";

interface Creds {
  baseUrl: string;
  authHeader: string;
}

/** Parse a stored access URL (https://user:pass@host/path) into base URL + Basic auth. */
function parseAccessUrl(raw: string): Creds {
  const trimmed = (raw || "").trim();
  const m = trimmed.match(/^(https?:\/\/)([^:@\s]+):([^@\s]+)@(.+)$/);
  if (!m) {
    throw new Error(
      "SimpleFIN access URL is malformed. Expected https://user:pass@host/path."
    );
  }
  const [, scheme, user, pass, rest] = m;
  const creds = Buffer.from(`${user}:${pass}`).toString("base64");
  return { baseUrl: scheme + rest, authHeader: `Basic ${creds}` };
}

async function simpleFinGet(
  creds: Creds,
  path: string,
  query?: Record<string, string | number | undefined>
): Promise<any> {
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) params.set(k, String(v));
    }
  }
  const qs = params.toString();
  const url = creds.baseUrl + path + (qs ? `?${qs}` : "");
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: creds.authHeader, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`SimpleFIN ${path} ${resp.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`SimpleFIN ${path}: non-JSON response: ${text.slice(0, 200)}`);
  }
}

/** Guess account type/class from the provider's org + account name. */
function inferType(name: string, org: string): { type: AccountType; classification: AccountClass } {
  const hay = `${name} ${org}`.toLowerCase();
  const looksCredit = /(credit|card|visa|mastercard|amex|american express|discover)/.test(hay);
  return looksCredit
    ? { type: "credit_card", classification: "liability" }
    : { type: "bank", classification: "asset" };
}

function friendlyBank(org: any): string {
  if (org && org.name) return String(org.name);
  if (org && org.domain) return String(org.domain).replace(/\..*$/, "");
  return "Unknown";
}

function unixToDate(ts: any): Date | null {
  if (ts == null || ts === "") return null;
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime()) ? null : d;
}

function shapeTxn(t: any): NormTxn {
  const ts = t.transacted_at || t.posted || 0;
  return {
    providerTxnId: String(t.id || ""),
    postedAt: unixToDate(ts) ?? new Date(),
    amountCents: toCents(String(t.amount ?? "0")), // preserves negative outflows
    payee: String(t.payee || "").trim(),
    description: String(t.description || "").trim(),
    memo: String(t.memo || "").trim(),
    pending: !!t.pending,
  };
}

function shapeAccount(a: any): NormAccount {
  const balanceStr = a.balance != null ? a.balance : a["available-balance"] != null ? a["available-balance"] : "0";
  const institution = friendlyBank(a.org);
  const { type, classification } = inferType(a.name || "", institution + " " + (a.org?.domain || ""));
  return {
    providerAccountId: String(a.id || ""),
    name: String(a.name || "Account"),
    institution,
    type,
    classification,
    currency: String(a.currency || "USD"),
    balanceCents: toCents(String(balanceStr)),
    balanceDate: unixToDate(a["balance-date"]),
    transactions: Array.isArray(a.transactions) ? a.transactions.map(shapeTxn) : [],
  };
}

export const simplefinProvider: FeedProvider = {
  id: "simplefin",

  async claim(setupToken: string): Promise<string> {
    const token = String(setupToken || "").trim();
    if (!token) throw new Error("Paste the setup token from bridge.simplefin.org.");
    let claimUrl: string;
    try {
      claimUrl = Buffer.from(token, "base64").toString("utf8").trim();
    } catch {
      throw new Error("Setup token is not valid base64. Did you paste the right value?");
    }
    if (!/^https?:\/\//.test(claimUrl)) {
      throw new Error("Decoded setup token does not look like a URL.");
    }
    const resp = await fetch(claimUrl, { method: "POST", body: "" });
    const body = (await resp.text()).trim();
    if (!resp.ok) {
      throw new Error(`Claim failed (${resp.status}): ${body.slice(0, 200)}`);
    }
    if (!/^https?:\/\/.+:.+@.+/.test(body)) {
      throw new Error("Claim returned an unexpected response (expected a URL with credentials).");
    }
    return body; // the access URL — caller encrypts + stores it
  },

  async fetch(accessUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const creds = parseAccessUrl(accessUrl);
    const query: Record<string, string | number | undefined> = {};
    if (opts.balancesOnly) {
      query["balances-only"] = 1;
    } else {
      if (opts.startDate) query["start-date"] = Math.floor(opts.startDate.getTime() / 1000);
      query["end-date"] = Math.floor(Date.now() / 1000);
      if (opts.pending) query["pending"] = 1;
    }
    const raw = await simpleFinGet(creds, "/accounts", query);
    const accounts = Array.isArray(raw.accounts) ? raw.accounts.map(shapeAccount) : [];
    const errors = Array.isArray(raw.errors) ? raw.errors.map(String) : [];
    return { accounts, errors };
  },
};
