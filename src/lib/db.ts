import { PrismaClient } from "@prisma/client";

// The Prisma client is created against one of three backends, chosen at runtime:
//
//   1. Turso (libSQL)  — when TURSO_DATABASE_URL is set. This is the Cloudflare
//      Workers path: Prisma talks to Turso over HTTP via the libSQL driver
//      adapter (works on the Workers runtime, which has no TCP sockets).
//   2. Netlify DB (Neon/Postgres) — when a NETLIFY_DATABASE_URL is available.
//   3. Local SQLite file — the default for `npm run dev` and the CLI.
//
// Only one is active per environment; the imports for the others are harmless.

/** Netlify DB (Neon) connection string, if running on Netlify. */
function resolveNetlifyUrl(): string | undefined {
  if (process.env.NETLIFY_DATABASE_URL) return process.env.NETLIFY_DATABASE_URL;
  if (process.env.NETLIFY_DATABASE_URL_UNPOOLED) return process.env.NETLIFY_DATABASE_URL_UNPOOLED;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@netlify/database");
    const url = mod?.getConnectionString?.();
    return url || undefined;
  } catch {
    return undefined;
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma(): PrismaClient {
  const log: ("error" | "warn")[] =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  // 1) Turso / libSQL (Cloudflare Workers). Use the "web" build of the adapter —
  //    it speaks HTTP and runs on the Workers runtime (and on Node 18+).
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaLibSQL } = require("@prisma/adapter-libsql/web");
    const adapter = new PrismaLibSQL({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return new PrismaClient({ adapter, log });
  }

  // 2) Netlify DB (Neon / Postgres).
  const netlifyUrl = resolveNetlifyUrl();
  if (netlifyUrl) {
    return new PrismaClient({ datasourceUrl: netlifyUrl, log });
  }

  // 3) Local SQLite file (dev / CLI).
  return new PrismaClient({ log });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
