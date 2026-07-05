// A single attachment.
//   GET    — stream the raw file bytes for inline viewing (image thumbnails, PDF
//            preview). The base64 blob is decoded to a Buffer and served with the
//            stored mime type and an inline content-disposition.
//   DELETE — remove the attachment.
//
// Dynamic segment `params` is a Promise in Next 15 and must be awaited.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export const runtime = "nodejs";

/** Escape a filename for safe use inside a quoted content-disposition header. */
function safeFilename(name: string): string {
  return name.replace(/[\r\n"]/g, "_");
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;

  const attachment = await prisma.attachment.findUnique({ where: { id } });
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
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;

  const existing = await prisma.attachment.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  await prisma.attachment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
