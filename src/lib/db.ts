import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql/web";

// The Prisma client backend is chosen at runtime:
//   - Production (Cloudflare Workers): Turso over HTTP via the libSQL driver
//     adapter (the "web" build runs on the Workers runtime — fetch-based, no
//     native module, no filesystem access).
//   - Local dev / CLI: the SQLite file from the DATABASE_URL datasource.
//
// Note on dates: writes and reads both go through the SAME engine per
// environment, so DateTime storage/query formats always agree. (On Turso the
// libSQL adapter does both; locally the native SQLite engine does both.)

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    const adapter = new PrismaLibSQL({ url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN });
    return new PrismaClient({ adapter });
  }
  // Local dev / CLI: SQLite file via the DATABASE_URL datasource.
  return new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
