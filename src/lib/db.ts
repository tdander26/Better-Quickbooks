import { PrismaClient } from "@prisma/client";

// Resolve the Postgres connection string at runtime. On Netlify, the Netlify DB
// (Neon) URL is provided by the Neon extension / @netlify/database SDK and is
// NOT reliably readable as a plain env var by Prisma's schema `env(...)` at
// runtime — so resolve it here and hand it to Prisma via `datasourceUrl`.
// Locally this returns undefined and Prisma falls back to the SQLite datasource.
function resolveDatabaseUrl(): string | undefined {
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
  const url = resolveDatabaseUrl();
  return new PrismaClient({
    ...(url ? { datasourceUrl: url } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
