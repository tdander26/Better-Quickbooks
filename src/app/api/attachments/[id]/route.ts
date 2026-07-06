// A single attachment.
//   GET    — stream the raw file bytes for inline viewing (image thumbnails, PDF
//            preview). The base64 blob is decoded to a Buffer and served with the
//            stored mime type and an inline content-disposition.
//   DELETE — remove the attachment.
//
// Dynamic segment `params` is a Promise in Next 15 and must be awaited.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";

export const runtime = "nodejs";

/** Escape a filename for safe use inside a quoted content-disposition header. */
function safeFilename(name: string): string {
  return name.replace(/[\r\n"]/g, "_");
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const attachment = await prisma.attachment.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  const buffer = Buffer.from(attachment.dataBase64, "base64");

  return new Response(buffer, {
    headers: {
      "content-type": attachment.mimeType || "application/octet-stream",
      "content-disposition": `inline; filename="${safeFilename(attachment.filename)}"`,
      "content-length": String(buffer.length),
      "cache-control": "private, max-age=3600",
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const deleted = await prisma.attachment.deleteMany({ where: { id, businessId: ctx.businessId } });
  if (deleted.count === 0) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
