// Re-run the rules engine across existing transactions that are still
// uncategorized and unreviewed. Confirmed splits are never touched.
// Returns { updated } — the number of transactions recategorized.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { reapplyRules } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  const { updated } = await reapplyRules();
  return NextResponse.json({ updated });
}
