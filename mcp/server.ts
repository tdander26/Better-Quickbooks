// Better Books MCP server (stdio).
//
// Exposes the app's data and operations as MCP tools so Claude Code / Claude
// Desktop can read and act on your books in natural language. Runs locally on
// the same machine as the app and talks to the SAME database directly — it
// imports the app's own src/lib/* modules, so there is no HTTP layer and no
// duplicated business logic.
//
// Run:  npm run mcp   (i.e. tsx mcp/server.ts)
//
// Security: the web app's password/cookie gate does NOT apply here — a stdio
// server has direct DB access. Anything that can launch this process (and read
// DATABASE_URL + ENCRYPTION_KEY from the environment) has full read/write access
// to your books. Intended for local, single-user use only. See mcp/README.md.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { prisma } from "@/lib/db";
import { registerReadTools } from "./tools/reads.js";
import { registerWriteTools } from "./tools/writes.js";

async function main() {
  const server = new McpServer({
    name: "better-books",
    version: "0.1.0",
  });

  registerReadTools(server);
  registerWriteTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean up the Prisma connection on shutdown.
  const shutdown = async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (e) => {
  // stdout is the MCP transport — log diagnostics to stderr only.
  console.error("Better Books MCP server failed to start:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
