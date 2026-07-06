// Sign-up: create a User (hashed password) + their first Business, then the
// client signs in via the credentials provider. Public route (allowlisted in
// middleware under /api/auth).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createBusiness } from "@/lib/business";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().trim().max(120).optional(),
  businessName: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists. Try signing in." },
      { status: 409 }
    );
  }

  const name = parsed.data.name || null;
  const user = await prisma.user.create({
    data: { email, name, passwordHash: await hashPassword(parsed.data.password) },
  });

  const businessName = parsed.data.businessName || (name ? `${name}'s Business` : "My Business");
  await createBusiness(user.id, businessName, "owner");

  return NextResponse.json({ ok: true }, { status: 201 });
}
