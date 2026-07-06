// Team invites for the active business. GET lists pending invites; POST creates
// one and emails it. Admin+ only.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";
import { sendInviteEmail } from "@/lib/email";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

export async function GET() {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const invites = await prisma.invite.findMany({
    where: { businessId: ctx.businessId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ invites });
}

export async function POST(req: NextRequest) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  // Already a member of this business?
  const existingMember = await prisma.membership.findFirst({
    where: { businessId: ctx.businessId, user: { email } },
  });
  if (existingMember) {
    return NextResponse.json({ error: "That person is already on the team." }, { status: 409 });
  }

  // Supersede any earlier pending invite for the same email.
  await prisma.invite.updateMany({
    where: { businessId: ctx.businessId, email, status: "pending" },
    data: { status: "revoked" },
  });

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const invite = await prisma.invite.create({
    data: {
      businessId: ctx.businessId,
      email,
      role: parsed.data.role,
      token,
      invitedById: ctx.user.id,
      expiresAt,
    },
  });

  const inviteUrl = `${req.nextUrl.origin}/invite/${token}`;
  try {
    await sendInviteEmail({
      to: email,
      businessName: ctx.business.name,
      inviterName: ctx.user.name,
      role: parsed.data.role,
      inviteUrl,
    });
  } catch (e) {
    // Keep the invite even if delivery failed — surface the link so the admin
    // can share it manually.
    return NextResponse.json({
      ok: true,
      invite,
      inviteUrl,
      emailError: e instanceof Error ? e.message : "Email delivery failed",
    });
  }

  return NextResponse.json({ ok: true, invite, inviteUrl });
}
