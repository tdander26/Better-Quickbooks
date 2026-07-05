// Toggle whether transactions are "cleared" during a reconciliation.
//   POST { transactionId, cleared }         — single transaction
//   POST { ids: [...], cleared }             — batch
// Setting cleared=true moves 'uncleared' -> 'cleared'. Setting cleared=false
// moves 'cleared' -> 'uncleared'. Already-'reconciled' transactions are left
// untouched (never silently downgraded) unless { force: true } is passed.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ids: string[] = Array.isArray(body.ids)
    ? body.ids.map(String).filter(Boolean)
    : body.transactionId
    ? [String(body.transactionId)]
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No transactions specified" }, { status: 400 });
  }
  if (typeof body.cleared !== "boolean") {
    return NextResponse.json({ error: "`cleared` must be a boolean" }, { status: 400 });
  }

  const target = body.cleared ? "cleared" : "uncleared";
  const force = body.force === true;

  const res = await prisma.transaction.updateMany({
    where: {
      id: { in: ids },
      // Don't downgrade a finalized ('reconciled') transaction unless forced.
      ...(force ? {} : { clearedStatus: { not: "reconciled" } }),
    },
    data: { clearedStatus: target },
  });

  return NextResponse.json({ ok: true, updated: res.count });
}
