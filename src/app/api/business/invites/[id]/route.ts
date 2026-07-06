// Revoke a pending invite (admin+).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const res = await prisma.invite.updateMany({
    where: { id, businessId: ctx.businessId, status: "pending" },
    data: { status: "revoked" },
  });
  if (res.count === 0) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
