# Ledger — Hosting & Database Cost Comparison (early 2026, approximate)

## Assumptions
- Bookkeeping app = LOW traffic + LOW data per user (~10–50 MB/user).
  Compute stays cheap for a long time; the DATABASE is what scales your bill.
- App is relational (Prisma / Postgres or SQLite). NoSQL options (Firestore,
  Mongo) would need a full rewrite — not recommended.
- Excludes: bank aggregation (SimpleFIN = flat/cheap; Plaid = $0.30–0.60 per
  connected account/mo) and domain (~$1/mo). Those sit on top of any stack.
- Prices change — treat as ranges.

## Database options
| DB                    | Free tier                | First paid            | Fit    | Notes |
|-----------------------|--------------------------|-----------------------|--------|-------|
| Neon (Postgres)       | 0.5 GB, scales to zero   | $19/mo (10 GB)        | *****  | Serverless, edge-friendly. Previously used on Netlify. |
| Turso (SQLite/libSQL) | 9 GB, 1B reads/mo        | ~$5/mo                | *****  | Matches SQLite dev schema; huge free tier. **Chosen.** |
| Cloudflare D1 (SQLite)| 5 GB, 5M reads/day       | included in $5 Workers| *****  | Best if hosting on Cloudflare (co-located). |
| Supabase (Postgres)   | 500 MB, pauses when idle | $25/mo (8 GB)         | ****   | Bonus: built-in auth for multi-user later. |
| CockroachDB           | 10 GB serverless         | usage after           | ****   | Postgres-compatible, distributed. |
| Google Cloud SQL      | none (trial credits)     | ~$25–50/mo realistic  | ***    | Enterprise-grade, NO scale-to-zero = higher floor. |
| AWS RDS (Postgres)    | 12 mo free, then $15–30+ | ~$15–30/mo            | ***    | Powerful, more ops/backups to manage. |
| PlanetScale (MySQL)   | none anymore             | ~$39/mo               | ***    | Great scaling, pricey floor now. |
| Render Postgres       | free ~30–90 days         | ~$6/mo                | ***    | Fine if hosting on Render too. |
| Google Firestore      | 1 GB, 50k reads/day      | usage                 | X      | NoSQL — needs full rewrite. Skip. |

## Host providers (Next.js SSR)
| Host                     | Free tier              | Paid floor     | Migration?          | Best for |
|--------------------------|------------------------|----------------|---------------------|----------|
| Cloudflare (Workers)     | very generous          | $5/mo          | Yes (edge runtime)  | Cheapest at scale. **Chosen.** |
| Google Cloud Run         | generous, scale-to-zero| ~$0–5 low use  | Minor (Docker)      | Cheap compute, Google stack |
| Netlify                  | monthly credits        | ~$19/mo Pro    | No (was current)    | Easiest; credits can pause you |
| Render                   | free (spins down)      | $7/mo          | No                  | Simple, business-friendly |
| Fly.io                   | small allowance        | ~$2–5/mo       | Minor (Docker)      | Control + low cost |
| Vercel                   | free NON-COMMERCIAL    | $20/user/mo    | No                  | Best DX, priciest — avoid for budget business |

## Total monthly cost as you scale (host + DB only)
| Stack                              | 1 user | 10 users | 100 users | 1,000 users |
|------------------------------------|--------|----------|-----------|-------------|
| A. Cloudflare + D1/Turso (cheapest)| $0     | $0–5     | ~$5       | ~$5–15      |
| B. Netlify + Neon (no migration)   | $0     | $0*      | ~$19–38   | ~$40–90     |
| C. Cloudflare + Neon (balanced)    | $0     | $5       | ~$24      | ~$24–74     |
| D. Google Cloud Run + Cloud SQL    | ~$0–10 | ~$10–15  | ~$25–40   | ~$50–150    |
* Netlify free "works" at 10 users but build/bandwidth credits can pause you.

## Recommendation (cost-first, scalable)
- Now to ~100 users: **Cloudflare Workers + Turso** = ~$5/mo flat. Cheapest
  durable option; cost is a one-time edge-runtime migration (this repo is now
  set up for it — see `docs/DEPLOY_CLOUDFLARE_TURSO.md`).
- Zero migration effort: Cloudflare or Netlify + Neon. Neon scale-to-zero keeps
  the DB near-free early, ~$19 when you outgrow it.
- Avoid early: Vercel (commercial licensing), Cloud SQL / PlanetScale / RDS
  (higher fixed floors). Great later, overkill/pricey now.
- Biggest cost lever isn't hosting — it's DB tier and bank-connection fees.
  Stay on SimpleFIN over Plaid as users grow.

Bottom line: run at $0–5/mo well past 100 users on Cloudflare + Turso.
Hosting won't be the constraint — data and bank-data will.
