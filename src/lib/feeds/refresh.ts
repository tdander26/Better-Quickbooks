// Shared bank-feed refresh, extracted so both POST /api/feeds/refresh and the
// MCP server drive the same sync: decrypt the stored access URL, pull new
// transactions (with a 3-day overlap so late-posting items aren't missed),
// import + dedupe them, and record the outcome on the connection.

import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/feeds";
import { decrypt } from "@/lib/crypto";
import { importNormalizedAccounts, type ImportSummary } from "@/lib/sync";

/** Thrown for user-correctable problems (not connected, unreadable credentials). */
export class FeedRefreshError extends Error {}

/** n days before `from`, without pulling in a date library. */
function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000);
}

/**
 * Refresh the most recent feed connection. Throws FeedRefreshError for
 * user-facing problems; on a provider/network failure it records the error on
 * the connection (status = "error") and rethrows.
 */
export async function refreshFeeds(): Promise<ImportSummary> {
  const conn = await prisma.feedConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!conn) {
    throw new FeedRefreshError("Not connected. Add your SimpleFIN setup token first.");
  }

  let accessUrl: string;
  try {
    accessUrl = decrypt(conn.accessUrlEnc);
  } catch {
    throw new FeedRefreshError(
      "Stored bank credentials couldn't be read. Please reconnect SimpleFIN."
    );
  }

  const startDate = conn.lastSyncedAt ? daysAgo(3, conn.lastSyncedAt) : daysAgo(90);
  const provider = getProvider("simplefin");

  try {
    const { accounts, errors } = await provider.fetch(accessUrl, { startDate, pending: true });
    const summary = await importNormalizedAccounts(accounts, {
      source: "simplefin",
      connectionId: conn.id,
      providerErrors: errors,
    });
    await prisma.feedConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncedAt: new Date(),
        status: "connected",
        lastError: errors.length ? errors.join("; ") : null,
      },
    });
    return summary;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refresh failed. Please try again.";
    await prisma.feedConnection.update({
      where: { id: conn.id },
      data: { status: "error", lastError: msg },
    });
    throw e;
  }
}
