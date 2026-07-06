// Finalize a reconciliation.
//   POST { accountId, endDate (ISO), endingBalanceCents }
// Server re-verifies the math (never trust the client): it recomputes the cleared
// balance as opening + Σ(cleared|reconciled amounts up to endDate) and requires
// the difference against the statement's ending balance to be exactly $0. If so,
// it locks every 'cleared' transaction up to endDate as 'reconciled' and records
// a Statement. Otherwise it returns 400 with the current difference.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await requireBusinessContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const accountId = String(body.accountId ?? "");
  if (!accountId) {
    return NextResponse.json({ error: "Missing account" }, { status: 400 });
  }

  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, businessId: ctx.businessId },
  });
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
      businessId: ctx.businessId,
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
  const result = await prisma.$transaction(async (tx) => {
    // Lock the newly-cleared transactions in this statement's window.
    const upd = await tx.transaction.updateMany({
      where: { businessId: ctx.businessId, accountId, clearedStatus: "cleared", postedAt: { lte: end } },
      data: { clearedStatus: "reconciled", reconciledAt: now },
    });
    const statement = await tx.statement.create({
      data: {
        businessId: ctx.businessId,
        accountId,
        endDate: end,
        endingBalanceCents,
        transactionCount: upd.count,
        reconciledAt: now,
      },
    });
    return { statementId: statement.id, reconciledCount: upd.count };
  });

  return NextResponse.json({ ok: true, ...result });
}
