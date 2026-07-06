# Better Books

A friendly, self-hosted **QuickBooks Online clone** for a single business/owner. It pulls your bank & credit-card feeds via **SimpleFIN**, **auto-categorizes** transactions with a rules engine you can extend, and generates real **Profit & Loss** and **Balance Sheet** statements. Built to be fast and pleasant on **desktop and phone**.

> Works with **Chase** and **Ally** (and any other institution SimpleFIN supports), across **checking/bank** and **credit-card** accounts.

## Features

- 📊 **Dashboard** — net worth, this-month income/expenses/net, income-vs-expense trend, spending-by-category donut, accounts snapshot, and a "needs attention" queue for uncategorized transactions.
- 🏦 **Accounts** — bank & credit-card accounts with computed balances, bank-reported balances, and reconciliation differences; per-account register with running balance.
- 🔁 **Transactions** — searchable/filterable register with **inline categorization**, **splits**, **transfers**, **bulk actions**, and manual entry. Mark items reviewed as you go.
- 🧠 **Auto-categorization rules** — first-match, priority-ordered rules engine. Ships with sensible defaults for common Chase/Ally patterns; add your own and **re-apply** any time.
- 📈 **Reports** — Profit & Loss, Balance Sheet (with the accounting-equation check), and Cash Flow, over any date range, with **CSV export**.
- 🔗 **SimpleFIN feed** — paste a setup token once; hit **Refresh** to import new balances & transactions (deduped, then auto-categorized). Pluggable provider design so **Teller** can be added later.
- 📥 **CSV import** — bring in history or accounts SimpleFIN doesn't cover.
- 📱 **Mobile-ready PWA** — responsive layout, bottom-tab navigation, installable to your home screen.
- 🔒 **Private** — single-user PIN/password gate; stored bank credentials are **encrypted at rest** (AES-256-GCM).

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Prisma · SQLite (local) / PostgreSQL (production) · Recharts.

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env
#   - APP_PASSWORD: the PIN/password you'll use to log in
#   - ENCRYPTION_KEY: generate one:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#     ...and paste it as ENCRYPTION_KEY in .env

# 3. Create the database and load demo data
npm run db:reset      # pushes schema + seeds mock Chase/Ally data

# 4. Run it
npm run dev           # http://localhost:3000
```

Log in with your `APP_PASSWORD`. The app opens on the Dashboard with seeded demo data so every screen has something to show. When you're ready, connect your real feed (below) — or run `npm run db:reset` any time to return to demo data.

### Handy scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run db:seed` | Re-seed demo data |
| `npm run db:reset` | Wipe DB, re-push schema, re-seed |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (money + rules engine) |

## Connecting your bank (SimpleFIN)

1. Sign up at **[bridge.simplefin.org](https://bridge.simplefin.org)** and connect your Chase + Ally accounts there.
2. Generate a **Setup Token** in the SimpleFIN dashboard.
3. In Better Books go to **Settings → Bank feed**, paste the token, and connect. The one-time token is exchanged for a long-lived **access URL** which is **encrypted** (AES-256-GCM) before it's stored — never kept in plaintext.
4. Use **Refresh** on Settings (or the dashboard) any time to pull new balances and transactions. Imports are **deduplicated** by SimpleFIN transaction id and run through your categorization rules automatically.

The SimpleFIN protocol logic (token claim → access URL → `GET /accounts`) lives in `src/lib/feeds/simplefin.ts`, behind the `FeedProvider` interface in `src/lib/feeds/types.ts`.

## Deploying to production (Vercel + Postgres)

The schema is written to be **Postgres-portable**. To deploy:

1. Create a free Postgres database (e.g. **Neon** or **Supabase**) and copy its connection string.
2. In `prisma/schema.prisma`, change the datasource provider:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Push to a GitHub repo and import it into **Vercel**. Set these Environment Variables in Vercel:
   - `DATABASE_URL` — your Postgres connection string
   - `APP_PASSWORD` — your login PIN/password
   - `ENCRYPTION_KEY` — a 64-hex-char key (as above)
4. Run the migration against your production DB once: `npx prisma db push` (with `DATABASE_URL` pointing at Postgres), then optionally `npm run db:seed`.
5. Deploy. The build runs `prisma generate` automatically.

### Recommended: Cloudflare Workers + Turso (cheapest, fits free tiers)
The app is also set up to deploy on **Cloudflare Workers** with **Turso**
(libSQL) — the cheapest durable stack ($0 to start, ~$5/mo later).
- **Runbook:** [`docs/DEPLOY_CLOUDFLARE_TURSO.md`](docs/DEPLOY_CLOUDFLARE_TURSO.md)
- **Host & database cost comparison (1 → 1,000 users):** [`docs/HOSTING_COSTS.md`](docs/HOSTING_COSTS.md)

## How the accounting works

- Money is stored as **integer cents** everywhere (no floats).
- Each transaction's `amountCents` is **signed** (SimpleFIN convention: inflow positive, outflow negative). Its category **splits** sum to that amount.
- **Account balance** = opening balance + Σ transactions. **Net worth** = Σ asset balances − Σ liability balances.
- **P&L** sums income- and expense-section splits over a date range; **Balance Sheet** reports asset/liability balances and derives equity. **Transfers** are excluded from P&L so moving money between your own accounts never looks like income or spending.

## Project structure

```
src/
  app/                 # App Router pages + API routes
    (dashboard, accounts, transactions, reports, rules, settings, login)
    api/               # feeds/refresh, transactions, rules, export, categories, auth …
  components/          # AppShell (nav), shared UI kit, charts
  lib/
    feeds/             # FeedProvider interface + SimpleFIN implementation
    reports.ts         # P&L, Balance Sheet, Cash Flow, trends
    categorize.ts      # rules engine (pure, unit-tested)
    sync.ts            # import + dedupe + auto-categorize
    money.ts crypto.ts auth.ts db.ts types.ts
prisma/
  schema.prisma        # data model
  seed.ts              # chart of accounts, default rules, demo data
```

## Security notes

- The app is gated by a single `APP_PASSWORD`; the session cookie is signed (HMAC) and expiring.
- Your SimpleFIN access URL (which contains bank credentials) is encrypted with `ENCRYPTION_KEY`. Keep that key secret and stable — rotating it makes an existing stored feed unreadable (just reconnect).
- Don't commit `.env`. It's gitignored.
