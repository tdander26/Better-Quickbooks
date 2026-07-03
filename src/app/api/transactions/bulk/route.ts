// Bulk transaction actions applied to a set of ids:
//   setCategory   -> replace each single-split txn's category (skips multi-split), mark reviewed
//   markReviewed  -> reviewed = true
//   unreview      -> reviewed = false
//   markTransfer  -> collapse each txn to one Transfer split, mark reviewed, flag transferId
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { TRANSFER_CATEGORY } from "@/lib/types";

export const runtime = "nodejs";

const ACTIONS = ["setCategory", "markReviewed", "markTransfer", "unreview"] as const;
type BulkAction = (typeof ACTIONS)[number];

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  const action = String(body.action ?? "") as BulkAction;

  if (ids.length === 0) {
    return NextResponse.json({ error: "No transactions selected" }, { status: 400 });
  }
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown bulk action" }, { status: 400 });
  }

  // ------------------------------------------------------------- markReviewed
  if (action === "markReviewed" || action === "unreview") {
    const res = await prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: { reviewed: action === "markReviewed" },
    });
    return NextResponse.json({ ok: true, updated: res.count });
  }

  // -------------------------------------------------------------- setCategory
  if (action === "setCategory") {
    const categoryId = body.categoryId ? String(body.categoryId) : "";
    if (!categoryId) {
      return NextResponse.json({ error: "Pick a category" }, { status: 400 });
    }
    const cat = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) return NextResponse.json({ error: "That category doesn't exist" }, { status: 400 });

    // Only touch simple (single-split) transactions; leave splits alone.
    const txns = await prisma.transaction.findMany({
      where: { id: { in: ids } },
      include: { splits: true },
    });

    let updated = 0;
    let skipped = 0;
    for (const t of txns) {
      if (t.splits.length !== 1) {
        skipped++;
        continue;
      }
      await prisma.$transaction([
        prisma.split.update({ where: { id: t.splits[0].id }, data: { categoryId } }),
        prisma.transaction.update({ where: { id: t.id }, data: { reviewed: true } }),
      ]);
      updated++;
    }
    return NextResponse.json({ ok: true, updated, skipped });
  }

  // ------------------------------------------------------------- markTransfer
  const transferCat = await prisma.category.findFirst({ where: { name: TRANSFER_CATEGORY } });
  const txns = await prisma.transaction.findMany({ where: { id: { in: ids } } });

  let updated = 0;
  for (const t of txns) {
    await prisma.$transaction(async (tx) => {
      await tx.split.deleteMany({ where: { transactionId: t.id } });
      await tx.split.create({
        data: { transactionId: t.id, amountCents: t.amountCents, categoryId: transferCat?.id ?? null },
      });
      await tx.transaction.update({
        where: { id: t.id },
        data: { reviewed: true, transferId: t.transferId ?? randomUUID() },
      });
    });
    updated++;
  }
  return NextResponse.json({ ok: true, updated });
}
