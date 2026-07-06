// Connect a SimpleFIN bank feed.
//   POST { setupToken } — claim the one-time setup token for a long-lived access
//   URL, encrypt + store it as the single FeedConnection, then immediately pull
//   the last 90 days so the user sees data right away.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";
import { getProvider } from "@/lib/feeds";
import { encrypt } from "@/lib/crypto";
import { importNormalizedAccounts } from "@/lib/sync";

export const runtime = "nodejs";

/** n days before `from`, without pulling in a date library. */
function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000);
}

export async function POST(req: NextRequest) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => null);
  const setupToken = String(body?.setupToken ?? "").trim();
  if (!setupToken) {
    return NextResponse.json(
      { error: "Paste your SimpleFIN setup token from bridge.simplefin.org." },
      { status: 400 }
    );
  }

  const provider = getProvider("simplefin");

  // 1) Exchange the setup token for a credential-bearing access URL.
  let accessUrl: string;
  try {
    accessUrl = await provider.claim(setupToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't claim that setup token.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 2) Persist a new connection for this business with the encrypted URL.
  const conn = await prisma.feedConnection.create({
    data: {
      businessId: ctx.businessId,
      provider: "simplefin",
      accessUrlEnc: encrypt(accessUrl),
      status: "connected",
    },
  });

  // 3) Initial sync: last 90 days including pending.
  try {
    const { accounts, errors } = await provider.fetch(accessUrl, {
      startDate: daysAgo(90),
      pending: true,
    });
    const summary = await importNormalizedAccounts(accounts, {
      businessId: ctx.businessId,
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
    const msg = e instanceof Error ? e.message : "Connected, but the initial sync failed.";
    await prisma.feedConnection.update({
      where: { id: conn.id },
      data: { status: "error", lastError: msg },
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
