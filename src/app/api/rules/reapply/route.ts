// Re-run the rules engine across existing transactions that are still
// uncategorized and unreviewed. Confirmed splits are never touched.
// Returns { updated } — the number of transactions recategorized.
import { NextResponse } from "next/server";
import { requireBusinessContext } from "@/lib/session";
import { reapplyRules } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST() {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;

  const { updated } = await reapplyRules(ctx.businessId);
  return NextResponse.json({ updated });
}
