# Deploy the multi-tenant app (Cloudflare Workers + Turso)

`main` is now the **multi-tenant SaaS** version (next-auth accounts, teams,
Stripe billing, `businessId`-scoped data). The previously-deployed Worker ran the
old single-tenant version against a single-tenant Turso DB, so going live is NOT
a plain redeploy — the database needs the new schema and a real user/business.

Verified before writing this: `next build`, `cf:build`, and the `workerd` runtime
all pass; `/login` renders and Prisma reaches Turso on Workers. The steps below
are the only remaining work, and they must run from a machine with your Turso +
Cloudflare logins (they can't run from the Claude sandbox — org network policy
blocks it from reaching turso.io and Cloudflare's API).

Demo login created by the seed: **`demo@betterbooks.app` / `demo1234`**
(override with `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`). The demo business is
seeded with `subscriptionStatus: "active"`, so it bypasses billing — **no Stripe
needed** to use it (Stripe is only for brand-new paid signups).

---

## One-time: fresh database + deploy

```bash
cd ~/Better-Quickbooks
git checkout main && git pull origin main
npm install

# 1) Recreate Turso with the new multi-tenant schema (existing DB is demo data)
turso db destroy ledger --yes
turso db create ledger
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > schema.sql
turso db shell ledger < schema.sql
turso db show ledger --url         # -> copy the libsql:// URL
turso db tokens create ledger      # -> copy the token (keep private)

# 2) Seed a demo user + business + data into Turso
export TURSO_DATABASE_URL="<paste URL>"
export TURSO_AUTH_TOKEN="<paste token>"
export SEED_USER_EMAIL="you@example.com"       # the email you'll log in with
export SEED_USER_PASSWORD="<choose a password>"
npm run db:seed

# 3) Set / update Cloudflare secrets
echo "$TURSO_DATABASE_URL" | npx wrangler secret put TURSO_DATABASE_URL
echo "$TURSO_AUTH_TOKEN"   | npx wrangler secret put TURSO_AUTH_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put AUTH_SECRET
#   ENCRYPTION_KEY is already set from the first deploy; APP_PASSWORD is unused now.
#   (Optional, only if you enable paid signups later:)
#   npx wrangler secret put STRIPE_SECRET_KEY
#   npx wrangler secret put STRIPE_WEBHOOK_SECRET
#   STRIPE_PRICE_ID / NEXT_PUBLIC_STRIPE_PRICE_ID as build vars

# 4) Build + deploy
npm run cf:build
npm run cf:deploy
```

Then open `https://ledger.betterbooks.workers.dev` and sign in with the email +
password from step 2. If the sign-in redirect misbehaves, add one more secret and
redeploy: `npx wrangler secret put AUTH_URL` = `https://ledger.betterbooks.workers.dev`.

## Redeploys after code changes
No DB steps needed again — just:
```bash
git pull origin main && npm run cf:build && npm run cf:deploy
```

## Env var reference (runtime secrets on the Worker)
| Var | Needed | Notes |
|-----|--------|-------|
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | yes | Turso connection |
| `AUTH_SECRET` | yes | next-auth session signing (any 32-byte hex) |
| `ENCRYPTION_KEY` | yes | AES key for stored bank-feed credentials |
| `AUTH_URL` | if redirect issues | your deployed origin |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` | only for paid signups | demo login works without them |
