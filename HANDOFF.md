# Continue: deploy "Better-QuickBooks" (Ledger) and automate future deploys

> Paste this whole file as the first message of a **local** Claude Code session
> on the Mac (in the project folder) — a local session has the Cloudflare + Turso
> logins and normal network, so Claude can run the deploy itself. A cloud/remote
> session is network-policy-blocked from Turso/Cloudflare and cannot deploy.

You are taking over a project mid-flight. Read this fully, then DO the work
yourself — run the terminal commands, don't hand them back to me. I want
automation; I should not have to run terminal commands over and over. When you
genuinely can't do something, say so directly and give one clear action.

## What this is
- Repo: github.com/tdander26/Better-Quickbooks. Work on `main`.
- Next.js 15 (app router, TypeScript, Tailwind). Prisma ORM.
- DB: Turso (libSQL/SQLite). Hosting: Cloudflare Workers via OpenNext
  (`@opennextjs/cloudflare` + `wrangler`). Auth: next-auth v5, MULTI-TENANT
  (users / businesses / teams, Stripe billing, every model scoped by `businessId`).
- Live Worker: "ledger" at https://ledger.betterbooks.workers.dev
  Turso DB name: `ledger`. URL: `libsql://ledger-tdander26.aws-us-east-1.turso.io`

## Current state
- `main` = multi-tenant SaaS + a cockpit UX update (Categorize screen: skip /
  no-auto-open picker, batch change-category + dismiss, rule-suggestion editor).
- VERIFIED deploy-ready: `next build`, `npm run cf:build`, and the real `workerd`
  runtime all pass; `/login` renders and Prisma reaches Turso on Workers.
- NOT deployed yet. The currently-live Worker still runs an OLD single-tenant
  build, so a plain redeploy is unsafe — the Turso DB needs the new schema and a
  real user/business.

## Immediate goal: deploy `main` live (do this yourself)
Fill the `<...>` from command output as you go:
1. `git checkout main && git pull && npm install`
2. Fresh Turso DB with the new schema (current DB is demo data, safe to wipe):
   ```bash
   turso db destroy ledger --yes && turso db create ledger
   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > schema.sql
   turso db shell ledger < schema.sql
   turso db show ledger --url         # -> <url>
   turso db tokens create ledger      # -> <token>
   ```
3. Seed demo user + business + data (creates the login + demo business):
   ```bash
   export TURSO_DATABASE_URL="<url>" TURSO_AUTH_TOKEN="<token>"
   export SEED_USER_EMAIL="doc@drtoddanderson.com" SEED_USER_PASSWORD="<ask me or pick one>"
   npm run db:seed
   ```
4. Cloudflare secrets:
   ```bash
   echo "$TURSO_DATABASE_URL" | npx wrangler secret put TURSO_DATABASE_URL
   echo "$TURSO_AUTH_TOKEN"   | npx wrangler secret put TURSO_AUTH_TOKEN
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put AUTH_SECRET
   # ENCRYPTION_KEY already set from a prior deploy; Stripe keys optional.
   ```
5. Build WITH the demo button on, then deploy:
   ```bash
   NEXT_PUBLIC_DEMO_LOGIN=1 npm run cf:build && npm run cf:deploy
   ```
6. Verify: open the workers.dev URL — there should be a "Continue to demo — no
   password" button (lands in the seeded demo business), plus email/password and
   real signup. Also check `/api/health` returns `ok:true` with an account count.
   Full runbook: `docs/DEPLOY_MULTITENANT.md`.

## Then: automate deploys so I stop using the terminal
Set up **Cloudflare Workers Builds** (Git integration) so every push to `main`
auto-builds + deploys — no more manual `cf:deploy`. Connect the `ledger` Worker to
the GitHub repo, branch `main`, build command `npm run cf:build`, deploy command
`npx wrangler deploy`, and add build variable `NEXT_PUBLIC_DEMO_LOGIN=1`. Do as
much as possible yourself; walk me through only the dashboard clicks you truly
can't do. After that, deploy = push to `main`.

## Hard-won gotchas (don't rediscover these)
- Prisma on Workers: `next.config.mjs` MUST have
  `serverExternalPackages: ["@prisma/client", ".prisma/client"]` (already set) or
  you get `[unenv] fs.readdir is not implemented`. Use `@prisma/adapter-libsql/web`
  (NOT the node `.` export — it pulls native binaries and breaks the build).
- Applying schema to Turso: use `npx prisma migrate diff … --script` (NOT
  `npm run db:sql`, whose npm banner corrupts the SQL). `prisma db push` can't talk
  to `libsql://` — always go through `turso db shell < schema.sql`.
- The libSQL adapter is date-format self-consistent; Turso data written via the
  adapter filters correctly (don't "fix" this).
- Demo login: `demo@betterbooks.app` / `demo1234` (override via `SEED_USER_*`). The
  demo business is `active`; new signups default to `trialing` — both work without
  Stripe.

## Standing rules
Do everything yourself. Don't make me run the terminal repeatedly. Push and make
things live as much as you can. Commit + PR + merge to `main` for code changes. Be
direct and actionable when you hit a real limit.
