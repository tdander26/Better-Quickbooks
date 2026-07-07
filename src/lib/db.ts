import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql/web";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Prisma on Cloudflare Workers needs ONE client PER REQUEST — verified the hard
// way on the live runtime:
//   - A single shared/module client works for sequential requests but THROWS
//     under concurrency: "A promise was resolved or rejected from a different
//     request context than the one it was created in" — Workers forbids using an
//     I/O continuation across request boundaries, and Prisma's query promises
//     leak across the concurrent requests that share the client.
//   - Creating a client on every access (e.g. behind a proxy that relies on
//     React cache() to memoize) blows the Worker CPU limit, because React
//     cache() does NOT memoize in this runtime (measured: cacheMemoizes=false).
// So: memoize exactly one client per request, keyed on the per-request execution
// context. Constructing a client is essentially free (measured initMs≈0); the
// WeakMap lets each request's client be GC'd when the request ends.
//
// Local dev / CLI (e.g. `npm run db:seed`) has no request context, so it uses a
// stable module singleton against the SQLite file / Turso.
//
// Note on dates: writes and reads both go through the SAME engine per
// environment, so DateTime storage/query formats always agree.

function createPrisma(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    const adapter = new PrismaLibSQL({ url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN });
    return new PrismaClient({ adapter });
  }
  return new PrismaClient();
}

let scriptClient: PrismaClient | undefined;
const perRequest = new WeakMap<object, PrismaClient>();

// A stable, unique-per-request object to key the client on. The Workers
// ExecutionContext is created fresh for each request, so different concurrent
// requests never collide, and repeated calls within one request return the same
// reference. Returns null outside a request (CLI, build) or if unavailable.
function requestKey(): object | null {
  try {
    const cf = getCloudflareContext() as unknown as { ctx?: object } | undefined;
    if (!cf) return null;
    return cf.ctx ?? (cf as object);
  } catch {
    return null;
  }
}

function resolveClient(): PrismaClient {
  const key = process.env.NEXT_RUNTIME ? requestKey() : null;
  if (!key) return (scriptClient ??= createPrisma());
  let client = perRequest.get(key);
  if (!client) {
    client = createPrisma();
    perRequest.set(key, client);
  }
  return client;
}

// Back-compat: call sites keep importing `{ prisma }` and using it directly.
// The proxy resolves the correct per-request (or per-script) client per access;
// resolveClient() is cheap and returns the SAME client for the whole request.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = resolveClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
