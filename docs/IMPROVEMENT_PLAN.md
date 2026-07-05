# Better Books — Review & Improvement Plan

Based on a full code audit (transactions workspace, rules engine, transfers,
reports, dashboard/accounts/settings, data model, and general quality).
Organized into phases; each phase ships independently.

## Status

- ✅ **Phase 0 (fixes)** and ✅ **Phase 1 (smart badges)** — SHIPPED.
  - Rule provenance (`Split.matchedRuleId`, `Transaction.categorizedBy`) persisted
    on import/CSV/manual/re-apply; rule `matchCount`/`lastMatchedAt` tracked.
  - Transfer auto-linking unified in `src/lib/transfers.ts` — fixes bulk transfer
    (was assigning mismatched ids), auto-links on import/CSV, and links the demo
    seed's transfer pairs. Matches any transfer-section category.
  - Category icons render correctly (`src/lib/icons.tsx`).
  - Global `loading.tsx` + `error.tsx`.
  - Smart badges (`src/lib/badges.ts`, `TxnBadges`): Auto (rule name), Needs
    review, Uncategorized, Pending, Transfer (linked/unmatched), Split, Recurring,
    Possible duplicate, Large ($5k) — on the table + mobile cards, with detectors
    in `src/lib/badge-context.ts`. Verified with tests + screenshots.
- ⏭️ **Next up:** Phase 2 QoL (create-rule-from-transaction, undo, report
  drill-down, date groups) then Phase 3 parity (reconciliation, attachments,
  recurring page). Invoices deprioritized per owner.

---

## Phase 0 — Fix what the audit caught (bugs & dead features)

These are defects in the current app, not new features. Do these first.

1. **Rule provenance is thrown away.** `categorize()` returns which rule
   matched, but `sync.ts`, the CSV importer, and `reapplyRules` discard it.
   → Add `Split.matchedRuleId` + `Transaction.categorizedBy`
   (`"rule" | "manual" | "import" | null`) and persist them everywhere a
   category is assigned. This is also the foundation for smart badges.
2. **Bulk "Mark transfer" never links pairs.** It assigns each selected txn a
   fresh random `transferId` (api/transactions/bulk/route.ts:89) instead of
   matching counterparts → both sides stay unlinked. Reuse the single-PATCH
   counterpart-matching logic.
3. **Transfers are never auto-linked on import.** Rules with `markTransfer`
   set the category only. → After each import batch, run a transfer-matching
   pass (opposite amount, different account, ±5 days, unique candidate).
4. **Seed data leaves demo transfers unlinked**, so the linkage feature looks
   dead out of the box. Link the seeded TO/FROM and card-payment pairs.
5. **Category icons render as raw text** ("stethoscope") in Settings.
   → Map lucide icon names to components; add a small icon+color picker.
6. **Optimistic UI lies about transfer linking** (`transferId:"pending"` set
   unconditionally) — reflect the server result instead.
7. **Missing loading/error states**: no `loading.tsx`/`error.tsx` anywhere;
   a slow query = blank hung page. Add skeletons + error boundaries per route.

## Phase 1 — Smart transaction badges (headline feature)

A consistent badge system on every transaction row (table + mobile cards +
account register), driven by real data, each badge clickable to filter:

| Badge | Signal | Source |
| --- | --- | --- |
| ⚡ **Auto** (with rule name on tap/hover) | Categorized by a rule | `matchedRuleId` (Phase 0.1) |
| 👀 **Needs review** | Auto/import-categorized, not yet confirmed | `reviewed=false` + categorizedBy |
| ❓ **Uncategorized** | No real category | existing |
| 🕐 **Pending** | Bank hasn't posted it | existing (keep) |
| 🔁 **Transfer** — linked vs **Unmatched** | `transferId` with/without a counterpart | Phase 0.2/0.3 |
| ✂️ **Split** | Multi-split transaction | splits.length > 1 |
| 🔄 **Recurring** | Same payee ± similar amount on a ~weekly/monthly cadence | new detector (lib/recurring.ts) |
| ⚠️ **Possible duplicate** | Same account+amount within 3 days, different feed id | new detector |
| 💰 **Large** | Amount > configurable threshold (e.g. $1,000) | setting |

Implementation notes:
- One `<TxnBadges txn={...}/>` component in `src/components` (kill the current
  ad-hoc Pending chip); recurring/duplicate flags computed server-side in the
  page query so badges are consistent everywhere.
- "Needs attention" on the dashboard extends to count duplicates + unmatched
  transfers, not just uncategorized/pending.

## Phase 2 — Quality-of-life improvements

**Transactions workspace**
- **Create rule from transaction** (core QBO feature, currently missing):
  row action → pre-filled rule dialog ("payee contains X → category Y"),
  option to apply to existing matches immediately.
- **Undo**: toast with Undo for categorize/bulk/delete (soft-delete or
  store-and-restore) instead of `window.confirm`-and-gone.
- **Date group headers** (Today / Yesterday / This week / June 2026) instead
  of a flat list.
- **Keyboard flow**: j/k row navigation, `c` to open a type-ahead category
  picker, `r` mark reviewed, `Enter` details — power-user categorizing.
- **Memo editing** in the details modal (field exists, searchable, not editable).
- **Bulk delete** + "select all N matching" across pages (current select-all
  covers only the visible 50).
- **Export CSV button** on the transactions page (API exists; no UI entry).
- Column sort (date/amount/payee).

**Reports**
- **Drill-down**: every statement line links to
  `/transactions?category=…&start=…&end=…` (data already there).
- **Comparison column**: vs previous period / same period last year, with Δ.
- **Monthly P&L columns** (Jan–Dec grid) — the classic accountant view.
- **Balance Sheet "as of" any date** (currently today-only).
- **Account filter** on P&L/Cash Flow.

**Accounts & Settings**
- **Archive / reorder accounts** (fields exist, no UI).
- **Import history** page (ImportBatch is recorded, never shown): when, source,
  imported/skipped counts, link to that batch's transactions.
- **Rule stats**: show matchCount/lastMatchedAt per rule; flag dead rules.
- Category **color picker** + subcategory support (parent/child fully modeled
  in the schema, unused — nest in picker and roll up in reports).

**Code health (from audit)**
- Deduplicate: `api()`/`readError()` fetch helpers, `groupCategories()`,
  `buildWhere` (page vs API — drift risk), `resolveRange`, rule loading,
  transfer-collapse logic → shared modules.
- Batch the per-row awaits: `createMany`/single-query dedupe in sync + CSV
  import; one grouped query for `monthlyTrend` (currently 6 serial P&Ls);
  transactional bulk updates.
- Accessibility: focus trap + focus return in modals, `aria-live` on toasts,
  non-color-only reviewed state.

## Phase 3 — QuickBooks-parity features (pick per need)

Ordered by usefulness for a small practice on bank-feed accounting:

1. **Bank reconciliation workflow** (the biggest missing QBO feature):
   per-transaction cleared/reconciled status, "reconcile to statement" flow
   (enter statement end date + balance, tick transactions until difference
   is $0), locked reconciled periods. Schema: `Transaction.clearedStatus`,
   `reconciledAt`, `Statement` model.
2. **Receipts & attachments**: attach a photo/PDF to a transaction (local file
   storage folder; the physician use-case: EOBs, invoices, receipts).
3. **Recurring transactions**: from the Phase 1 detector, a "Recurring" page
   showing subscriptions/bills with expected next date + missed-payment flags.
4. **Budgets**: monthly budget per category, budget-vs-actual report + bars
   on the dashboard (deferred from v1 by choice).
5. **Payees/Vendors registry**: normalize messy feed payees ("AMZN Mktp" →
   "Amazon"), per-payee history and totals, payee merge.
6. **Tax support**: map categories to Schedule C lines; year-end "tax package"
   export (P&L by tax line + receipts).
7. **Mileage log** (simple manual entries at the IRS rate) — QBO has it,
   relevant for a physician driving between clinics.
8. **Invoicing/customers** — QBO's other half. Only if you bill patients
   directly outside your EHR; otherwise skip.
9. **Audit log** of changes (QBO has one; cheap to add on mutations).
10. **Teller feed provider** — second bank-feed source behind the existing
    `FeedProvider` interface.

## Verification (every phase)

- Unit tests extend `categorize.test.ts` pattern: recurring detector,
  duplicate detector, transfer matcher, reconciliation math.
- `npm run typecheck` + `npm run build` + `npm test` green.
- Drive the real app (seeded) with Playwright at desktop + mobile widths;
  screenshot the badge states, reconcile flow, and reports.
- Accounting invariants stay asserted: Assets = Liabilities + Equity;
  splits sum to txn amount; transfers excluded from P&L.

## Suggested order

1. Phase 0 (fixes) + Phase 1 (badges) — one milestone, since badges depend on
   the provenance fields.
2. Phase 2 QoL: create-rule-from-txn, undo, drill-down reports, date groups.
3. Phase 3 №1–3 (reconciliation, attachments, recurring) — the real
   QuickBooks-parity jump.
4. Remaining Phase 2/3 items as wanted.
