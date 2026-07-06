import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql/web";

// With the queryCompiler generator (see prisma/schema.prisma) Prisma ships as a
// pure-TypeScript client with no query engine and no filesystem access — which is
// what lets it run on the Cloudflare Workers runtime. A libSQL driver adapter is
// therefore required in EVERY environment:
//
//   - Production (Cloudflare Workers): Turso, via TURSO_DATABASE_URL/_AUTH_TOKEN.
//   - Local dev / CLI: point TURSO_DATABASE_URL at your Turso DB, or run a local
//     libSQL server with `turso dev` and use its http URL. (See docs/DEPLOY_*.)
//
// The "web" build of the adapter speaks HTTP and works on both Workers and Node.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma(): PrismaClient {
  // Production (Cloudflare Workers): Turso over HTTP via the libSQL driver
  // adapter (the "web" build runs on the Workers runtime).
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    const adapter = new PrismaLibSQL({ url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN });
    return new PrismaClient({ adapter });
  }
  // Local dev / CLI: the SQLite file from the DATABASE_URL datasource.
  return new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
