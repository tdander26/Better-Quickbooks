// Single-account endpoint. PATCH updates provided fields; DELETE archives.
// Dynamic segment `params` is a Promise in Next 15 and must be awaited.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";
import { toCents } from "@/lib/money";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const existing = await prisma.financialAccount.findFirst({
    where: { id, businessId: ctx.businessId },
  });
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data: Prisma.FinancialAccountUpdateInput = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400 });
    data.name = name;
  }

  if (body.institution !== undefined) {
    const institution = String(body.institution).trim();
    if (!institution) return NextResponse.json({ error: "Institution is required" }, { status: 400 });
    data.institution = institution;
  }

  if (body.type !== undefined) {
    const type = String(body.type) as AccountType;
    if (!ACCOUNT_TYPES.includes(type)) {
      return NextResponse.json({ error: "Pick a valid account type" }, { status: 400 });
    }
    data.type = type;
    // Keep classification consistent with the account type.
    data.classification = type === "credit_card" ? "liability" : "asset";
  }

  if (body.openingBalance !== undefined) {
    data.openingBalanceCents = toCents(body.openingBalance);
  }

  if (body.openingDate !== undefined) {
    const parsed = new Date(String(body.openingDate));
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Opening date is not valid" }, { status: 400 });
    }
    data.openingDate = parsed;
  }

  if (body.archived !== undefined) {
    data.archived = Boolean(body.archived);
  }

  // `existing` is already confirmed to belong to this business.
  const account = await prisma.financialAccount.update({ where: { id }, data });
  return NextResponse.json({ ok: true, account });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const existing = await prisma.financialAccount.findFirst({
    where: { id, businessId: ctx.businessId },
  });
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Soft delete: archive so historical transactions & reports stay intact.
  await prisma.financialAccount.update({ where: { id }, data: { archived: true } });
  return NextResponse.json({ ok: true });
}
