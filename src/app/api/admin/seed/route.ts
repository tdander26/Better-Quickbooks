// One-time demo-data seeder for a fresh deployment. DESTRUCTIVE: seedDemoData()
// wipes ALL data (every tenant) and recreates a single demo user + business.
// Guarded three ways:
//  - requires a valid login session, AND
//  - requires the caller to be an owner, AND
//  - requires a matching x-seed-token header (process.env.ADMIN_SEED_TOKEN),
//    so it can never be triggered casually. Refuses to run if a user already
//    exists unless ?force=1 is passed.
import { NextRequest, NextResponse } from "next/server";
import { requireBusinessContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { seedDemoData } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await requireBusinessContext({ minRole: "owner", skipBilling: true });
  if (ctx instanceof NextResponse) return ctx;

  const token = process.env.ADMIN_SEED_TOKEN;
  if (!token || req.headers.get("x-seed-token") !== token) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const existing = await prisma.user.count();
  if (existing > 1 && !force) {
    return NextResponse.json(
      { ok: false, message: `Database already has ${existing} users. Pass ?force=1 to wipe and reseed.` },
      { status: 409 }
    );
  }

  const result = await seedDemoData();
  return NextResponse.json({ ok: true, ...result });
}
