// Accounts collection endpoint. POST creates a new bank/credit-card account.
// classification is derived from type (bank -> asset, credit_card -> liability).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { toCents } from "@/lib/money";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/types";

export const runtime = "nodejs";

function classificationFor(type: AccountType): "asset" | "liability" {
  return type === "credit_card" ? "liability" : "asset";
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const institution = String(body.institution ?? "").trim();
  const type = String(body.type ?? "") as AccountType;

  if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400 });
  if (!institution) return NextResponse.json({ error: "Institution is required" }, { status: 400 });
  if (!ACCOUNT_TYPES.includes(type)) {
    return NextResponse.json({ error: "Pick a valid account type" }, { status: 400 });
  }

  // Dollar inputs -> integer cents. openingBalance may be a string like "1,200.00".
  const openingBalanceCents = toCents(body.openingBalance ?? 0);

  let openingDate = new Date();
  if (body.openingDate) {
    const parsed = new Date(String(body.openingDate));
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Opening date is not valid" }, { status: 400 });
    }
    openingDate = parsed;
  }

  // Place new accounts at the end of the manual sort order.
  const last = await prisma.account.findFirst({ orderBy: { sortOrder: "desc" } });
  const sortOrder = (last?.sortOrder ?? 0) + 1;

  const account = await prisma.account.create({
    data: {
      name,
      institution,
      type,
      classification: classificationFor(type),
      openingBalanceCents,
      openingDate,
      sortOrder,
    },
  });

  return NextResponse.json({ ok: true, account }, { status: 201 });
}
