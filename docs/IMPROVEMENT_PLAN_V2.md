# Better Books — Improvement Plan v2

Successor to [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md) (phases 0–3 shipped).
Based on a 7-agent audit of the current `main` (rules engine, recognition
signals, transaction workspace, stability/runtime, dashboard & delight) plus a
market scan of QuickBooks Online, Monarch, Copilot, Lunch Money, Actual Budget,
Firefly III, and YNAB (2025–2026 feature sets).

Goals, in the owner's words: **stable · efficient · easy · still feature-rich ·
fun — with smart rules and transaction recognition as the headline.**

---

## Wave 0 — Lock the front door (do before anything else)

1. **Production demo login opens the owner's real books.**
   `.github/workflows/deploy.yml` builds with `NEXT_PUBLIC_DEMO_LOGIN: "1"`,
   which is inlined at build time, so the gate at `src/auth.ts:61` passes in
   prod. `ensureDemoUser()` (`src/auth.ts:22-37`) returns the **existing**
   `SEED_USER_EMAIL` user — documented as the owner's real email (commit
   aa9e451). The login page renders a visible "Continue to demo — no password"
   button. Net effect: anyone with the URL gets a one-click session over real
   financial data.
   → Remove the env from deploy.yml; make the demo provider refuse to return
   any user it didn't itself create (require a `demoFlag` on the user row);
   delete the login button when the flag is off; add a vitest for the refusal.
2. **Open self-registration.** `/api/auth/register` is public
   (`src/middleware.ts` PUBLIC_PATHS) and creates a user + owner business
   (`src/app/api/auth/register/route.ts:43-44`). On a personal instance,
   strangers can create accounts in the shared DB.
   → Gate behind an `ALLOWED_SIGNUP_EMAILS` env or invite-only flag.
3. **CI deploys with no gate.** deploy.yml runs checkout → `npm ci` →
   `cf:build` → `wrangler deploy`; `npm test` and `npm run typecheck` exist but
   never run. → Insert both between `npm ci` and build (or a `test` job with
   `needs:`).
4. **No backup story.** Nothing configures Turso PITR or dumps; the codebase
   ships a destructive all-tenant seed route (`src/app/api/admin/seed/route.ts`)
   and hard-deletes. → Nightly `.github/workflows/backup.yml`: `turso db shell
   $DB .dump` → workflow artifact or private R2 bucket. Check the Turso plan's
   built-in point-in-time restore first — the real gap may only be off-platform
   copies.
5. **Cross-tenant write hole (verified):** the splits-replace path accepts a
   foreign `categoryId` with no business check
   (`src/app/api/transactions/[id]/route.ts:115-130`) while the single-category
   path validates (~166-170). → Fix, then audit budgets / reconcile / bulk /
   transfer-counterpart paths for the same pattern.
6. **Auth hardening:** no rate limit or lockout on the credentials provider
   (`src/auth.ts:43-54`) — bcrypt per attempt on Worker CPU is brute-forceable.
   → Simple KV/DB counter with exponential lockout.

## Wave 1 — Stability: make the books un-corruptable

The sync pipeline is the trust core; these are the confirmed defects.

1. **Pending → posted collapse** *(critical)*. Sync stores `pending` rows but
   the dedupe path (`src/lib/sync.ts:111-119`) skips existing ids without
   updating, and nothing ever clears `pending` — permanent Pending badges, and
   phantom duplicates when the bank re-ids a posted charge. → In the
   existing-id branch, update `pending/postedAt/amountCents` when changed;
   before creating a posted row, look for a matching still-pending row (same
   account, amount, ±5 days) and merge into it. *(First: query the live DB for
   pending rows older than ~7 days to see which failure mode Chase/Ally
   actually exhibit.)*
2. **Idempotent, checkpointed sync.** Import is serial per-row
   findFirst+create with no error isolation: one bad row/account aborts the
   rest, ImportBatch rows freeze at `imported=0` with no status field.
   → Per-account try/catch; treat P2002 as `skipped++` (the `@@unique`
   constraint becomes the dedupe authority, making concurrent refreshes
   harmless); batch dedupe with one `findMany({providerTxnId: {in}})` and
   chunked creates; add `ImportBatch.status/error`.
3. **Sync mutex.** `FeedConnection.syncStartedAt` optimistic claim with a
   5-minute staleness window; return 409 "already running".
4. **SimpleFIN client resilience.** `simpleFinGet` (`src/lib/feeds/simplefin.ts:41-68`)
   has no timeout/retry. → `AbortSignal.timeout(20s)`, 3 attempts with backoff
   on 5xx/network, and a typed `FeedAuthError` on 402/403 that surfaces as a
   "Reconnect your bank" state instead of a generic error string.
5. **Money edge cases.** `toCents()` zeroes parens-negatives ("(1,620.00)" →
   CSV rows error-skipped) and has the `1.005` float edge (`src/lib/money.ts:5-12`).
   → Parens detection + integer-math parse + tests.
6. **Atomicity fixes:** wrap `reapplyRules`' split+transaction update pair in
   `$transaction` (`src/lib/sync.ts:222-226`); make `createBusiness` atomic
   (`src/lib/business.ts:30-38`); reconcile-finalize computes the cleared
   balance outside its locking transaction
   (`src/app/api/reconcile/finalize/route.ts:46-88` — verify, then fix).
7. **Write-path tests + CI smoke.** Only 4 test files exist, all pure helpers.
   → Phase 1: pure functions (transfers.pairUp, simplefin parsers, crypto
   round-trip). Phase 2: file-libSQL vitest for import dedupe/P2002/partial
   failure. Then one Playwright smoke (login → cockpit → file a txn) in CI.
8. **Zod-ify mutating routes** (zod already installed, used on 4 routes):
   bound memo lengths, amounts, CSV size; validate categoryIds belong to the
   business in one `findMany`.
9. **Integrity Checker page ("books doctor").** One button → read-only audits:
   splits-sum ≠ txn amount, orphaned/odd transfer groups, dangling categoryIds,
   ledger-vs-bank per account, accounting equation. Green checkmark or fix-it
   list; doubles as regression detection for everything below.
10. **Health endpoint v2.** `src/app/api/health/route.ts` still reports
    Netlify-era env vars. → Turso/auth env presence, DB latency, newest
    FeedConnection status, deploy SHA.
11. **Regex-rule guardrails.** User regex rules run uncompiled per txn on the
    import hot path (`src/lib/categorize.ts:64-68`); a catastrophic
    backtracker can kill a sync. → Length cap + nested-quantifier lint +
    timed test-execution at create; pre-compile per run.

## Wave 2 — Smart rules & recognition (the headline)

The market pattern everywhere: **suggestion + explicit confirmation, rules born
from corrections, immutable raw payee under a canonical merchant.** The engine
(`src/lib/categorize.ts`) is a clean, tested first-match evaluator — these
build on it.

### 2a. Foundations

1. **Payee normalization at ingest** (`cleanPayee` in a new `src/lib/payee.ts`):
   strip processor prefixes (SQ\*, TST\*, PAYPAL\*), order suffixes
   (`AMZN Mktp US*1A2B3C`), card last-4s, CITY ST tails; title-case. Keep the
   raw string in `description` (already stored). Apply at
   `src/lib/sync.ts:143` + CSV import + as the key for suggestion history,
   batch grouping, recurring, and duplicates — today these all whiff on
   exact-string mismatches, which is precisely where recognition matters most.
2. **Canonical `Payee` entity + alias map** *(the "app knows Costco is
   Costco" feature — Actual/YNAB/Lunch Money all converge here)*:
   `Payee { name, icon, defaultCategoryId? }` + `PayeeAlias { pattern → payeeId }`,
   nullable `Transaction.payeeId`, auto-create on first sight at import.
   Per-payee **default category is a learned rule the user never writes**;
   renaming a payee creates an alias (YNAB pattern); merge UI rewires
   transactions + aliases. Add YNAB's subtle winner: `Payee.autoCategorize`
   toggle — "Amazon is unpredictable, always ask me."
3. **Engine correctness batch** (small, do first):
   deterministic tie-break (`loadEnabledRules` has no `orderBy`,
   `src/lib/sync.ts:27` — can silently diverge from the UI's rule order);
   reapply change-detection (`reapplyRules` rewrites and re-counts no-ops, so
   `matchCount` inflates on every press, `src/lib/sync.ts:189-234`); duplicate-
   rule guard on POST; reject negative amount values (`amount gt -50` matches
   everything); CSV import should call `recordRuleHits`.

### 2b. Rule power

4. **Auto-file flag per rule** *(S effort, the single biggest efficiency win)*:
   `Rule.autoReview` — trusted rules (Gusto payroll, rent) set `reviewed: true`
   at import and skip the cockpit entirely. Today every rule match still queues
   for manual confirmation (`src/lib/sync.ts:136-160`). This is QBO's
   "auto-add" toggle; it converts rules from "saves a click" to "the books
   file themselves."
5. **Rule preview / dry-run** *(kills fear of bad rules)*: `POST
   /api/rules/preview` runs the draft against recent history → "would match 37
   transactions (12 uncategorized, 3 currently claimed by 'Payroll')" before
   save, and makes "Also re-categorize now" informed instead of blind.
6. **Multi-condition rules (AND)**: `Rule.conditions` JSON column, legacy
   triple maps to `conditions[0]`; `matchRule` becomes `conditions.every(...)`.
   Unlocks "payee contains Gusto AND amount > 1000".
7. **New condition types**: direction (in/out — fixes magnitude-only
   blindness), amount between, `account_id` (by id, with a picker — the current
   account condition string-matches `institution + name` and breaks on
   rename), day-of-month.
8. **New actions**: payee-rename ("and rename to…" — compounds with everything
   keyed on payee), split-by-percentage (the chiropractor classic:
   phone/internet 50% business), memo/note set.
9. **Rule stats + health UI**: `matchCount/lastMatchedAt` are recorded but
   rendered nowhere (`src/app/rules/page.tsx:28-40` omits them). Show
   "Matched 128 · last hit Jun 30" linking to `/transactions?ruleId=…`;
   flag never-fired and shadowed rules (first-match semantics silently kill
   later rules); per-rule scoped re-apply.
10. **Fix the suggestion loop**: cockpit surfaces exactly one rule suggestion,
    forgets dismissals on reload (client `useState` only), uses substring
    "already covered" logic instead of the engine, and caps history at 400
    txns (`src/lib/cockpit.ts:428-465`). → Top-5 persistent suggestions,
    `RuleSuggestionMute` table, coverage check via `matchRule` on a synthetic
    context, history from a splits groupBy.

### 2c. Recognition

11. **Global, payee-aware duplicate detection** (current: page-scoped O(n²)
    over 50 visible rows, payee-blind → false positives on two same-priced
    coffees, misses cross-page twins) + dismiss/merge action
    (`Transaction.duplicateDismissedAt`).
12. **Recurring v2** (`src/lib/recurring-series.ts` is pure and testable):
    quarterly + annual cadences (malpractice insurance, license fees),
    regularity gate (MAD/median) so grocery noise stops flooding the page,
    variable-amount series, **price-increase alerts** ("Netflix went up $2"),
    "Ended" state instead of permanent red Overdue for cancelled
    subscriptions. Align the recurring badge with the page (they currently
    use different grouping and the badge has no cadence check at all).
13. **Transfer detection for uncategorized pairs**: today `linkTransfers` only
    links transactions already categorized as transfers — a checking→card
    payment pair is never *suggested*. Mutually-unique opposite-amount
    cross-account pairs within the window → auto-mark with
    `categorizedBy='transfer-detect'`; add an ambiguity guard to the greedy
    pairer.
14. **Amount-anomaly badge**: "this Costco run is 3× your usual" from
    per-payee median (free once the Payee entity exists).
15. **Manual↔imported matching (YNAB pattern)**: on import, match amount-equal
    unreconciled manual entries within ±10 days and queue a "same
    transaction?" card — makes hand-entering an expected check safe.

## Wave 3 — Efficiency & ease of use

1. **Full keyboard triage in the cockpit**: j/k navigate, Enter/a accept
   suggestion, c picker, s skip, u undo, 1-9 file batch N. All state
   machinery already exists (`_cockpit.tsx`); it's one gated keydown effect.
   Today both surfaces are 100 % mouse.
2. **Optimistic, parallel filing**: drop the single global `busy` flag —
   filing 40 one-offs currently costs a full Worker→Turso round trip of dead
   time each. Port the proven optimistic pattern from `_table.tsx:313-344`.
3. **Error feedback + honest skips in the cockpit** *(cheap, big trust win)*:
   every cockpit mutation currently swallows failure (`if (!ok) return;`) —
   a failed "File all 12" gives zero feedback; the bulk API already returns
   `{updated, skipped}` but the client discards it. Shared toast primitive
   (two near-identical implementations exist to consolidate).
4. **Undo stack + Undo-action toasts everywhere**: cockpit has a single
   overwritten undo slot; `/transactions` has none (delete is
   `window.confirm`-and-gone). Add an atomic bulk `unfile` action so batch
   undo can't half-apply (current batch undo is N parallel PATCHes that can
   desync silently).
5. **"Apply to 7 more like this"** follow-up toast after categorizing one
   txn in the register, chaining into "make it a rule" — the register's
   missing equivalent of cockpit batches.
6. **Select-all-across-filter** (Gmail banner): bulk endpoint accepts the
   filter instead of 50 explicit ids; share the where-builder between page and
   API (they've already drifted).
7. **Smart search tokens**: `starbucks last month >20`, bare `312.19` →
   amount/date/text filters with removable pills. Amount search alone answers
   the most common real question.
8. **Nightly Cloudflare cron refresh** (`triggers.crons` in wrangler.jsonc +
   `scheduled` handler): books are fresh and rule-filed every morning; smaller
   windows = less failure-prone syncs. Pair with a **global sync-status chip**
   in the header (green "Synced 2h ago" / amber stale / red failed → one-click
   refresh).
9. **Batch the import pipeline & dashboard queries**: dedupe via one `in`
   query; the dashboard fires ~8 sequential full-split P&L scans per render
   (`src/lib/reports.ts:349-361`) — one `$queryRaw` month-bucketed query.
   *(Measure Worker→Turso RTT first; if it's ~10-40 ms this drops a priority
   tier.)*
10. **Unified type-ahead CategoryPicker** (extract the cockpit's, use in the
    register + bulk bar; register still uses a native `<select>`).
11. **Saved views + sticky filters**; wire or remove the cockpit's dead
    "Filter"/"Sort" pills (they render as buttons and do nothing).
12. **Cockpit hygiene**: ship raw `amountCents` instead of re-parsing display
    strings; `router.refresh()` after mutations (nav badge/attention rail
    currently go stale); cap the unreviewed query with a count-backed footer.

## Wave 4 — Fun (tasteful for a books app)

1. **Zero-inbox celebration + streak**: the queue-cleared moment is the
   product's emotional payoff and currently renders one line of text. Session
   recap (23 filed · 4 categories · 3 min) + CSS-only confetti
   (prefers-reduced-motion aware) + server-verified inbox-zero streak.
2. **"Rules did the work" scoreboard**: "Your rules filed 84 transactions this
   month — about 42 minutes saved" + top-3 hardest-working rules. Makes
   creating rules self-reinforcing; data already exists in
   `Split.matchedRuleId`.
3. **Monday-morning digest** on the dashboard: rules-filed count, unusual
   spend vs prior period, subscriptions due in 7 days, possible duplicates.
   All composable from existing primitives (`src/lib/insights.ts`). Optional
   later: weekly email via Cloudflare Email Service.
4. **Month-in-review story card**: top categories, biggest delta, net income,
   % auto-categorized — styled like the cockpit's dark tax card, a
   screenshot-worthy close ritual.
5. **Net-worth sparkline** (phase 1 computed from transactions in one bucketed
   query; phase 2 a `BalanceSnapshot` written by the nightly cron — bank-
   reported balances are currently overwritten every sync, losing history).
6. **Practice profit goal**: `Business.profitGoalCents`, YTD progress bar with
   on-pace/behind-pace from day-of-year.
7. **Micro-animations on filing**: 160 ms row collapse, tally count-up —
   satisfying, not clippy.
8. **Papercut sweep**: charts switch to a dark palette on OS-dark while the
   app is light-only (near-invisible net line — delete the matchMedia branch);
   UTC greeting says "Good morning" at 7 pm in Minnesota (browser-clock client
   component + "Good evening, Todd" from session.user.name); cockpit hardcodes
   "Ledger · Anderson LLC" for every tenant; dashboard "Review" CTA links to
   the plain register instead of the cockpit; tax card links to /reports
   instead of /tax; "filed today" resets on reload (derive from
   `reviewed+updatedAt`); per-route loading skeletons; budgets "copy last
   month" + day-of-month pace marker on the bars.

## Wave 5 — Housekeeping (from the completeness critic)

- **Migrations strategy**: no `prisma/migrations/` dir; schema is applied by
  hand-run `db push` while CI auto-deploys code — a deploy can reference a
  column that doesn't exist yet. Adopt `migrate diff` scripts applied before
  deploy in CI.
- **Attachments → R2**: receipts are base64 TEXT in the primary DB (4 MB cap,
  full decode in Worker memory per view); R2 sits unused on the same platform.
- **Full-fidelity export/backup**: current CSV export drops archived accounts,
  splits, memos, rules, budgets. Add a JSON backup (+ restore) so "my data is
  portable" is actually true.
- **Stripe dead weight**: the whole billing subsystem gates every request via
  the 402 path yet is inert (subscriptionStatus defaults to "trialing"
  forever). Env-flag it off (`BILLING_ENABLED=0`) for the self-hosted case.
- **Netlify remnants**: netlify.toml, `netlify/` migrations, `@netlify/database`
  dep, and the hand-synced `prisma/schema.prod.prisma` twin (drift trap).
- **PWA**: manifest declares standalone but there is no service worker and no
  apple-touch PNG — installable but blank offline. Add a minimal SW shell +
  icons.
- Verify the second-business flow end-to-end (business switcher, per-business
  feed connections, category seeding) — the cockpit's hardcoded tenant name
  suggests more single-tenant assumptions in newer surfaces.

## Suggested order

1. **Wave 0** — same day; nothing else matters while the door is open.
2. **Wave 1 items 1–7** — the sync-correctness cluster + CI gate + backups.
3. **Wave 2a + auto-file + preview (2b.4–5)** — normalization, Payee entity,
   engine fixes, and the two features that make rules visibly do the work.
4. **Wave 3 items 1–5** — keyboard triage, optimistic filing, error toasts,
   undo. (The cockpit becomes a power tool.)
5. **Wave 4 items 1–3 + papercut sweep** — the fun layer, cheap after 2/3.
6. Everything else as appetite allows.

## Verification discipline (carried over from v1)

- Every wave: `npm run typecheck` + `npm test` green, new pure logic gets unit
  tests beside `categorize.test.ts`.
- Accounting invariants stay asserted: Assets = Liabilities + Equity; splits
  sum to txn amount; transfers excluded from P&L.
- Claims flagged by the audit as *estimated* (Worker→Turso latency, SimpleFIN
  pending-id behavior) get measured against the live instance before building
  on them.
