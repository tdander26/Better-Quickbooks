// Remove a member from the active business (admin+). Guards against removing the
// last owner, and enforces that only owners can remove owners/admins.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = await params;

  const target = await prisma.membership.findFirst({
    where: { businessId: ctx.businessId, userId },
  });
  if (!target) return NextResponse.json({ error: "Not a member" }, { status: 404 });

  if (target.role === "owner") {
    const owners = await prisma.membership.count({
      where: { businessId: ctx.businessId, role: "owner" },
    });
    if (owners <= 1) {
      return NextResponse.json({ error: "Can't remove the last owner." }, { status: 400 });
    }
    if (ctx.role !== "owner") {
      return NextResponse.json({ error: "Only an owner can remove an owner." }, { status: 403 });
    }
  }
  if (target.role === "admin" && ctx.role !== "owner") {
    return NextResponse.json({ error: "Only an owner can remove an admin." }, { status: 403 });
  }

  await prisma.membership.deleteMany({ where: { businessId: ctx.businessId, userId } });
  return NextResponse.json({ ok: true });
}
