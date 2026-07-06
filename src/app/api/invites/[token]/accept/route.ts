// Accept an invitation: the signed-in user (whose email must match the invite)
// joins the business with the invited role. Requires auth but NOT an existing
// active business — the user may be joining their first one.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await params;
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== "pending") {
    return NextResponse.json({ error: "This invitation is no longer valid." }, { status: 400 });
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.invite.update({ where: { id: invite.id }, data: { status: "expired" } });
    return NextResponse.json({ error: "This invitation has expired." }, { status: 400 });
  }

  const userEmail = (session.user.email ?? "").toLowerCase();
  if (userEmail !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { error: "This invitation was sent to a different email address." },
      { status: 403 }
    );
  }

  await prisma.membership.upsert({
    where: { userId_businessId: { userId: session.user.id, businessId: invite.businessId } },
    create: { userId: session.user.id, businessId: invite.businessId, role: invite.role },
    update: {}, // already a member — accepting is a no-op on role
  });
  await prisma.invite.update({ where: { id: invite.id }, data: { status: "accepted" } });

  return NextResponse.json({ ok: true, businessId: invite.businessId });
}
