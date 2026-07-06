# Deploy to Cloudflare Workers + Turso

This app is set up to run on **Cloudflare Workers** (via OpenNext) with **Turso**
(libSQL/SQLite) as the database. Target cost: **$0** to start (fits the free
tiers), ~$5/mo later.

Verified during setup:
- OpenNext build succeeds → `.open-next/worker.js`.
- Prisma talks to libSQL through the driver adapter (reads/relations work).
- Worker size: **~1.54 MB gzipped**, under Cloudflare's **3 MB free-tier limit**.

The one thing that can only be confirmed on your own account is the live Worker
runtime (Prisma's wasm engine + your real Turso credentials). Everything up to
that point is done and in the repo.

---

## 0. One-time installs (on your machine)
```bash
npm install                      # installs everything, incl. wrangler + turso adapter
npm i -g @tursodatabase/cli      # Turso CLI (or: brew install tursodatabase/tap/turso)
npx wrangler login               # opens browser, links your Cloudflare account
turso auth login                 # opens browser, links your Turso account
```

## 1. Create the Turso database
```bash
turso db create ledger
turso db show ledger --url                 # -> TURSO_DATABASE_URL (libsql://...)
turso db tokens create ledger              # -> TURSO_AUTH_TOKEN
```

## 2. Create the tables + seed demo data
```bash
# Generate the schema SQL from prisma/schema.prisma and load it into Turso:
npm run db:sql > schema.sql
turso db shell ledger < schema.sql

# (optional) seed demo data straight into Turso:
TURSO_DATABASE_URL="libsql://your-db.turso.io" \
TURSO_AUTH_TOKEN="your-token" \
npm run db:seed
```

## 3. Give Cloudflare your secrets
```bash
npx wrangler secret put APP_PASSWORD          # your login password
npx wrangler secret put ENCRYPTION_KEY        # 32-byte hex (see .env.example)
npx wrangler secret put TURSO_DATABASE_URL
npx wrangler secret put TURSO_AUTH_TOKEN
```
`NEXT_PUBLIC_DEMO_LOGIN` is a *build-time* public flag, not a secret. To enable
the no-password demo button, set it in the build environment (step 4) — e.g.
`NEXT_PUBLIC_DEMO_LOGIN=1 npm run cf:build`.

## 4. Build + deploy
```bash
npm run cf:build     # prisma generate + OpenNext build -> .open-next/
npm run cf:deploy    # uploads the Worker to Cloudflare
```
Wrangler prints your live URL (`https://ledger.<your-subdomain>.workers.dev`).

### Or: auto-deploy from GitHub (recommended)
In the **Cloudflare dashboard → Workers & Pages → Create → Connect to Git**,
pick this repo and set:
- **Build command:** `npm run cf:build`
- **Deploy command:** `npx wrangler deploy`
- Add the same variables/secrets from steps 3 under **Settings → Variables**.

Then every push to `main` deploys automatically (like Netlify did) — but on
Cloudflare's free tier.

## 5. (optional) Custom domain
Cloudflare dashboard → your Worker → **Settings → Domains & Routes → Add custom
domain**. Free if the domain's DNS is on Cloudflare.

---

## How the database is selected (src/lib/db.ts)
The app picks its backend at runtime, so the same code runs everywhere:
1. **Turso** — when `TURSO_DATABASE_URL` is set (Cloudflare). Uses the libSQL
   driver adapter over HTTP.
2. **Netlify DB (Postgres)** — when a `NETLIFY_DATABASE_URL` is present.
3. **Local SQLite file** — default for `npm run dev`.

So local development is unchanged; nothing here affects the old Netlify setup.

## Schema changes later
`prisma/schema.prisma` is the source of truth. After editing models:
```bash
npm run db:sql > schema.sql        # full CREATE for a fresh DB
# for an existing DB, diff against it and apply just the delta, e.g.:
npx prisma migrate diff \
  --from-url "libsql://...?authToken=..." \
  --to-schema-datamodel prisma/schema.prisma --script > delta.sql
turso db shell ledger < delta.sql
```

## Notes / gotchas
- **Prisma engine on Workers:** with the driver adapter, Prisma uses its WASM
  query engine (no native binary) — that's why this works on the Workers runtime.
  If a future Prisma upgrade complains about engine size, enable the
  `queryCompiler` preview feature to drop the WASM engine entirely.
- **Free-tier size:** current Worker is ~1.54 MB gzipped (limit 3 MB). If it ever
  grows past that, Workers Paid ($5/mo) raises the limit to 10 MB.
- **Turso free tier:** 9 GB storage, 1B row-reads/mo — plenty for a long time.
- The old Netlify config (`netlify.toml`, `prisma/schema.prod.prisma`,
  `@netlify/database`) is left in place and harmless; remove it once you're fully
  on Cloudflare.
