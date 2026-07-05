// Budgets collection endpoint.
//   GET  ?month=YYYY-MM — the budgets set for that month.
//   POST { categoryId, month, amountCents } — upsert one category's monthly
//         budget. amountCents <= 0 deletes the budget (clearing the target).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export const runtime = "nodejs";

const MONTH_RE = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "Pass a month as YYYY-MM." }, { status: 400 });
  }

  const budgets = await prisma.budget.findMany({
    where: { month },
    orderBy: { amountCents: "desc" },
  });
  return NextResponse.json({ budgets });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const categoryId = String(body.categoryId ?? "").trim();
  const month = String(body.month ?? "").trim();
  const amountCents = Math.round(Number(body.amountCents));

  if (!categoryId) {
    return NextResponse.json({ error: "Which category?" }, { status: 400 });
  }
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "Pass a month as YYYY-MM." }, { status: 400 });
  }
  if (!Number.isFinite(amountCents)) {
    return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
  }

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    return NextResponse.json({ error: "That category doesn't exist." }, { status: 404 });
  }
  if (category.section !== "expense") {
    return NextResponse.json({ error: "Only expense categories can be budgeted." }, { status: 400 });
  }

  // Clearing the budget: <= 0 removes the row entirely.
  if (amountCents <= 0) {
    await prisma.budget.deleteMany({ where: { categoryId, month } });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const budget = await prisma.budget.upsert({
    where: { categoryId_month: { categoryId, month } },
    update: { amountCents },
    create: { categoryId, month, amountCents },
  });
  return NextResponse.json({ ok: true, budget });
}
