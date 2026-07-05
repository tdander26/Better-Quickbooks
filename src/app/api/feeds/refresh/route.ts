// Refresh the SimpleFIN bank feed — the app's marquee action.
//   POST — decrypt the stored access URL, pull transactions since the last sync
//   (with a 3-day overlap so nothing slips through), import + dedupe them, and
//   report how many were new vs. skipped.
//
// The sync itself lives in src/lib/feeds/refresh.ts so the MCP server shares it.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { refreshFeeds, FeedRefreshError } from "@/lib/feeds/refresh";

export const runtime = "nodejs";

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const summary = await refreshFeeds();
    return NextResponse.json({
      ok: true,
      imported: summary.imported,
      skipped: summary.skipped,
      accountsSeen: summary.accountsSeen,
      errors: summary.errors,
    });
  } catch (e) {
    if (e instanceof FeedRefreshError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : "Refresh failed. Please try again.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
