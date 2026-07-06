// Single-transaction endpoint.
//   PATCH  — flexible edit. Accepts any of:
//     { categoryId }            -> collapse to one split with that category, mark reviewed
//     { splits: [...] }         -> replace all splits (must sum to the txn amount), mark reviewed
//     { transfer: true|false }  -> flag as an internal transfer (split -> Transfer category),
//                                  and, when a clear counterpart exists, link both sides
//     { payee, description, notes, reviewed } -> scalar field edits
//   DELETE — remove the transaction (its splits cascade).
//
// Dynamic segment `params` is a Promise in Next 15 and must be awaited.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { TRANSFER_CATEGORY } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;

  const txn = await prisma.transaction.findUnique({ where: { id }, include: { splits: true } });
  if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Scalar field edits that can ride along with any categorization change.
  const scalar: Prisma.TransactionUpdateInput = {};
  if (typeof body.payee === "string") scalar.payee = body.payee.trim();
  if (typeof body.description === "string") scalar.description = body.description.trim();
  if (typeof body.notes === "string") scalar.notes = body.notes;
  const reviewedFlag = (fallback: boolean) =>
    body.reviewed !== undefined ? Boolean(body.reviewed) : fallback;

  // --- Transfer flag -------------------------------------------------------
  if (body.transfer !== undefined) {
    if (body.transfer === false) {
      const transaction = await prisma.transaction.update({
        where: { id },
        data: { ...scalar, transferId: null, reviewed: reviewedFlag(txn.reviewed) },
      });
      return NextResponse.json({ ok: true, transaction });
    }

    const transferCat = await prisma.category.findFirst({ where: { name: TRANSFER_CATEGORY } });

    // Look for a single, unambiguous opposite-signed counterpart on another
    // account within a few days — the other side of the same transfer.
    const windowStart = new Date(txn.postedAt);
    windowStart.setDate(windowStart.getDate() - 5);
    const windowEnd = new Date(txn.postedAt);
    windowEnd.setDate(windowEnd.getDate() + 5);
    const candidates = await prisma.transaction.findMany({
      where: {
        id: { not: txn.id },
        accountId: { not: txn.accountId },
        amountCents: -txn.amountCents,
        transferId: null,
        postedAt: { gte: windowStart, lte: windowEnd },
      },
      take: 2,
    });
    const counterpart = candidates.length === 1 ? candidates[0] : null;
    const transferId = txn.transferId ?? counterpart?.transferId ?? randomUUID();

    // Array/batch form (not an interactive callback): the libSQL HTTP adapter
    // compiles this to a single atomic libSQL batch(). No op reads a value
    // written by an earlier op, so the direct rewrite is behavior-preserving.
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.split.deleteMany({ where: { transactionId: txn.id } }),
      prisma.split.create({
        data: { transactionId: txn.id, amountCents: txn.amountCents, categoryId: transferCat?.id ?? null },
      }),
      prisma.transaction.update({
        where: { id: txn.id },
        data: { ...scalar, transferId, reviewed: reviewedFlag(true) },
      }),
    ];
    if (counterpart) {
      ops.push(
        prisma.split.deleteMany({ where: { transactionId: counterpart.id } }),
        prisma.split.create({
          data: {
            transactionId: counterpart.id,
            amountCents: counterpart.amountCents,
            categoryId: transferCat?.id ?? null,
          },
        }),
        prisma.transaction.update({
          where: { id: counterpart.id },
          data: { transferId, reviewed: true },
        })
      );
    }
    await prisma.$transaction(ops);

    return NextResponse.json({ ok: true, linked: Boolean(counterpart) });
  }

  // --- Replace splits ------------------------------------------------------
  if (Array.isArray(body.splits)) {
    const incoming = body.splits as unknown[];
    if (incoming.length === 0) {
      return NextResponse.json({ error: "A transaction needs at least one split" }, { status: 400 });
    }

    const parsed: { categoryId: string | null; amountCents: number; memo: string }[] = [];
    for (const raw of incoming) {
      if (!raw || typeof raw !== "object") {
        return NextResponse.json({ error: "Invalid split" }, { status: 400 });
      }
      const s = raw as Record<string, unknown>;
      const amountCents = Math.round(Number(s.amountCents));
      if (!Number.isFinite(amountCents)) {
        return NextResponse.json({ error: "Each split needs a valid amount" }, { status: 400 });
      }
      parsed.push({
        categoryId: s.categoryId ? String(s.categoryId) : null,
        amountCents,
        memo: typeof s.memo === "string" ? s.memo : "",
      });
    }

    const sum = parsed.reduce((n, s) => n + s.amountCents, 0);
    if (sum !== txn.amountCents) {
      return NextResponse.json(
        {
          error: `Splits must add up to ${formatMoney(txn.amountCents)} (currently ${formatMoney(sum)})`,
        },
        { status: 400 }
      );
    }

    // Array/batch form: atomic single libSQL batch() on the HTTP adapter.
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.split.deleteMany({ where: { transactionId: txn.id } }),
    ];
    for (const s of parsed) {
      ops.push(
        prisma.split.create({
          data: {
            transactionId: txn.id,
            categoryId: s.categoryId,
            amountCents: s.amountCents,
            memo: s.memo,
          },
        })
      );
    }
    ops.push(
      prisma.transaction.update({
        where: { id: txn.id },
        data: { ...scalar, reviewed: reviewedFlag(true), categorizedBy: "manual" },
      })
    );
    await prisma.$transaction(ops);

    return NextResponse.json({ ok: true });
  }

  // --- Single-category assign (the fast inline categorize path) ------------
  if (body.categoryId !== undefined) {
    const categoryId = body.categoryId ? String(body.categoryId) : null;
    if (categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!cat) return NextResponse.json({ error: "That category doesn't exist" }, { status: 400 });
    }

    // Array/batch form: atomic single libSQL batch() on the HTTP adapter.
    await prisma.$transaction([
      prisma.split.deleteMany({ where: { transactionId: txn.id } }),
      prisma.split.create({
        data: { transactionId: txn.id, categoryId, amountCents: txn.amountCents },
      }),
      prisma.transaction.update({
        where: { id: txn.id },
        data: { ...scalar, reviewed: reviewedFlag(true), categorizedBy: "manual" },
      }),
    ]);

    return NextResponse.json({ ok: true });
  }

  // --- Scalar-only edit ----------------------------------------------------
  const data: Prisma.TransactionUpdateInput = { ...scalar };
  if (body.reviewed !== undefined) data.reviewed = Boolean(body.reviewed);
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const transaction = await prisma.transaction.update({ where: { id }, data });
  return NextResponse.json({ ok: true, transaction });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;

  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  await prisma.transaction.delete({ where: { id } }); // splits cascade
  return NextResponse.json({ ok: true });
}
