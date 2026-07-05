# Better Books MCP server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that
lets **Claude Code** and **Claude Desktop** read and act on your books in
natural language — "what's my net worth?", "categorize the Amazon charge as
Office Supplies", "refresh my feed and show me this month's P&L".

It runs on the same machine as the app and talks to the **same database**
directly (it imports the app's own `src/lib/*` modules), so there's no HTTP
layer, no separate API, and no duplicated business logic.

## Tools

**Read**

| Tool | What it returns |
| --- | --- |
| `list_accounts` | Accounts with computed vs. bank-reported balance + reconciliation diff |
| `get_net_worth` | Assets − liabilities |
| `list_transactions` | Filtered/paged register (search, account, category, status, date range) |
| `get_transaction` | One transaction with its splits |
| `list_categories` | The chart of accounts (optionally by section) |
| `list_rules` | Auto-categorization rules by priority |
| `profit_and_loss` | P&L for a date range (defaults to this month) |
| `balance_sheet` | Assets, liabilities, equity as of now |
| `cash_flow` | Inflows / outflows / net for a range |
| `spending_by_category` | Expense totals by category |
| `monthly_trend` | Income/expense/net for the last N months |

**Write**

| Tool | Effect |
| --- | --- |
| `create_transaction` | Add a manual transaction (signed dollars) |
| `categorize_transaction` | Assign a category to a transaction and mark it reviewed |
| `create_rule` | Add an auto-categorization rule |
| `reapply_rules` | Re-run rules over uncategorized, unreviewed transactions |
| `refresh_feed` | Pull + dedupe new transactions from the SimpleFIN feed |

Money is emitted as both integer `cents` and a formatted string; dates as ISO.

## Run it

```bash
npm install
npx prisma generate      # once, so the Prisma client exists
npm run db:reset         # optional: load demo data
npm run mcp              # starts the stdio server (reads .env automatically)
```

`npm run mcp` loads `.env` via `--env-file-if-exists=.env`, so it picks up the
same `DATABASE_URL` and `ENCRYPTION_KEY` the app uses.

### Smoke-test with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector npm run mcp
```

Then list tools and try `get_net_worth`, `profit_and_loss`, or
`list_transactions` with `filter: "uncategorized"`.

## Connect Claude Code

A project-scoped `.mcp.json` in the repo root already declares the server, so
Claude Code discovers it automatically. Run `/mcp` inside Claude Code to confirm
`better-books` is connected, then just ask questions.

`.mcp.json` intentionally does **not** contain `ENCRYPTION_KEY` — that secret is
read from `.env` (which is gitignored). Without it, every tool works except
`refresh_feed`, which needs it to decrypt the stored SimpleFIN access URL.

## Connect Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "better-books": {
      "command": "npx",
      "args": ["tsx", "--env-file-if-exists=.env", "mcp/server.ts"],
      "cwd": "/absolute/path/to/Better-Quickbooks"
    }
  }
}
```

## Security

The web app's `APP_PASSWORD` + signed-cookie gate is **HTTP-only** and does not
apply to this server. A stdio server has direct database access: anything that
can launch this process (and read `DATABASE_URL` + `ENCRYPTION_KEY` from the
environment) has full read/write access to your books. This is intended for
**local, single-user** use only — don't expose it over a network.
