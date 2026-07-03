// Refresh the SimpleFIN bank feed — the app's marquee action.
//   POST — decrypt the stored access URL, pull transactions since the last sync
//   (with a 3-day overlap so nothing slips through), import + dedupe them, and
//   report how many were new vs. skipped.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { getProvider } from "@/lib/feeds";
import { decrypt } from "@/lib/crypto";
import { importNormalizedAccounts } from "@/lib/sync";

export const runtime = "nodejs";

/** n days before `from`, without pulling in a date library. */
function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000);
}

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  const conn = await prisma.feedConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!conn) {
    return NextResponse.json(
      { error: "Not connected. Add your SimpleFIN setup token first." },
      { status: 400 }
    );
  }

  let accessUrl: string;
  try {
    accessUrl = decrypt(conn.accessUrlEnc);
  } catch {
    return NextResponse.json(
      { error: "Stored bank credentials couldn't be read. Please reconnect SimpleFIN." },
      { status: 400 }
    );
  }

  // Overlap the window by 3 days so transactions that posted late aren't missed;
  // the importer dedupes by provider transaction id, so re-seeing them is safe.
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
    return NextResponse.json({
      ok: true,
      imported: summary.imported,
      skipped: summary.skipped,
      accountsSeen: summary.accountsSeen,
      errors: summary.errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refresh failed. Please try again.";
    await prisma.feedConnection.update({
      where: { id: conn.id },
      data: { status: "error", lastError: msg },
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
