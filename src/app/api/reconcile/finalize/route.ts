// Finalize a reconciliation.
//   POST { accountId, endDate (ISO), endingBalanceCents }
// Server re-verifies the math (never trust the client): it recomputes the cleared
// balance as opening + Σ(cleared|reconciled amounts up to endDate) and requires
// the difference against the statement's ending balance to be exactly $0. If so,
// it locks every 'cleared' transaction up to endDate as 'reconciled' and records
// a Statement. Otherwise it returns 400 with the current difference.
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

  const accountId = String(body.accountId ?? "");
  if (!accountId) {
    return NextResponse.json({ error: "Missing account" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) {
    return NextResponse.json({ error: "That account doesn't exist" }, { status: 404 });
  }

  const end = new Date(String(body.endDate ?? ""));
  if (isNaN(end.getTime())) {
    return NextResponse.json({ error: "The statement end date isn't valid" }, { status: 400 });
  }

  const endingBalanceCents = Math.round(Number(body.endingBalanceCents));
  if (!Number.isFinite(endingBalanceCents)) {
    return NextResponse.json({ error: "The ending balance isn't valid" }, { status: 400 });
  }

  // Recompute the cleared balance server-side.
  const agg = await prisma.transaction.aggregate({
    where: {
      accountId,
      clearedStatus: { in: ["cleared", "reconciled"] },
      postedAt: { lte: end },
    },
    _sum: { amountCents: true },
  });
  const clearedBalanceCents = account.openingBalanceCents + (agg._sum.amountCents ?? 0);
  const difference = endingBalanceCents - clearedBalanceCents;

  if (difference !== 0) {
    return NextResponse.json(
      {
        error: "The reconciliation isn't balanced yet.",
        difference,
        clearedBalanceCents,
        endingBalanceCents,
      },
      { status: 400 }
    );
  }

  const now = new Date();

  // The statement's transactionCount depends on how many rows the updateMany
  // touches — a value produced inside the transaction. The libSQL HTTP adapter
  // doesn't support interactive ($transaction callback) transactions, so instead
  // count the affected rows first, then run the update + insert as one atomic
  // array/batch $transaction (the where-clause is identical, so the count the
  // updateMany would report equals this precount).
  const affected = await prisma.transaction.count({
    where: { accountId, clearedStatus: "cleared", postedAt: { lte: end } },
  });
  const [, statement] = await prisma.$transaction([
    prisma.transaction.updateMany({
      where: { accountId, clearedStatus: "cleared", postedAt: { lte: end } },
      data: { clearedStatus: "reconciled", reconciledAt: now },
    }),
    prisma.statement.create({
      data: {
        accountId,
        endDate: end,
        endingBalanceCents,
        transactionCount: affected,
        reconciledAt: now,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    statementId: statement.id,
    reconciledCount: affected,
  });
}
