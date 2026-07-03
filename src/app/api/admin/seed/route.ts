// One-time demo-data seeder for a fresh deployment. Guarded two ways:
//  - requires a valid login session, AND
//  - refuses to run if the database already has accounts (so it can never wipe
//    real data). Pass ?force=1 to reseed anyway (still requires auth).
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { seedDemoData } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  const existing = await prisma.account.count();
  if (existing > 0 && !force) {
    return NextResponse.json(
      { ok: false, message: `Database already has ${existing} accounts. Pass ?force=1 to reseed.` },
      { status: 409 }
    );
  }

  const result = await seedDemoData();
  return NextResponse.json({ ok: true, ...result });
}
