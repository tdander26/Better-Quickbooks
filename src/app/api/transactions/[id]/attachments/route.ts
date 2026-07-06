// Attachments for one transaction.
//   GET  — list this transaction's attachments (metadata only; never the base64
//          bytes, which can be large — those are streamed by /api/attachments/[id]).
//   POST — upload a receipt: { filename, mimeType, dataBase64 }. Only images and
//          PDFs are accepted, capped at 4 MB. Size is derived from the decoded
//          bytes and stored so the list/UI can show it without re-decoding.
//
// Dynamic segment `params` is a Promise in Next 15 and must be awaited.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

function isAllowedMime(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  // Verify the parent transaction belongs to this business before listing.
  const txn = await prisma.transaction.findFirst({
    where: { id, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const attachments = await prisma.attachment.findMany({
    where: { transactionId: id, businessId: ctx.businessId },
    orderBy: { createdAt: "asc" },
    // Deliberately omit dataBase64 — the list stays lightweight.
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  });

  return NextResponse.json({ attachments });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const txn = await prisma.transaction.findFirst({
    where: { id, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const filename = String(body.filename ?? "").trim() || "attachment";
  const mimeType = String(body.mimeType ?? "").trim();
  const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";

  if (!mimeType || !isAllowedMime(mimeType)) {
    return NextResponse.json(
      { error: "Only images or PDF files can be attached." },
      { status: 400 }
    );
  }
  if (!dataBase64) {
    return NextResponse.json({ error: "The file appears to be empty." }, { status: 400 });
  }

  // Decode to learn the real byte size (and to reject anything malformed).
  let sizeBytes: number;
  try {
    sizeBytes = Buffer.from(dataBase64, "base64").length;
  } catch {
    return NextResponse.json({ error: "Couldn't read that file." }, { status: 400 });
  }
  if (sizeBytes === 0) {
    return NextResponse.json({ error: "The file appears to be empty." }, { status: 400 });
  }
  if (sizeBytes > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is too large. Attachments must be 4 MB or smaller." },
      { status: 400 }
    );
  }

  const attachment = await prisma.attachment.create({
    data: { transactionId: id, businessId: ctx.businessId, filename, mimeType, sizeBytes, dataBase64 },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: attachment.id }, { status: 201 });
}
