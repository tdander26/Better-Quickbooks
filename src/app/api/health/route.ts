// Public diagnostic endpoint. Reports which env vars are present and whether the
// database is reachable (with the actual error if not). Safe: it never returns
// secret values, only booleans/lengths and the DB error message. Visit
// /api/health in a browser to see runtime status without opening dashboards.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = {
    NETLIFY: process.env.NETLIFY ?? null,
    hasNetlifyDatabaseUrl: !!process.env.NETLIFY_DATABASE_URL,
    hasNetlifyDatabaseUrlUnpooled: !!process.env.NETLIFY_DATABASE_URL_UNPOOLED,
    hasAppPassword: !!process.env.APP_PASSWORD,
    encryptionKeyLen: (process.env.ENCRYPTION_KEY || "").length,
  };

  let db: unknown = "ok";
  let accounts: number | null = null;
  try {
    accounts = await prisma.financialAccount.count();
  } catch (e) {
    const err = e as { message?: string; name?: string; code?: string };
    db = {
      name: err?.name ?? "Error",
      code: err?.code ?? null,
      message: String(err?.message ?? e).slice(0, 800),
    };
  }

  return NextResponse.json({ ok: db === "ok", env, accounts, db });
}
