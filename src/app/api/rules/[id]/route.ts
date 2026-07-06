// Single-rule endpoint. PATCH updates any provided fields (used for edits and
// for reordering via `priority`); DELETE removes the rule outright — rules aren't
// referenced by transactions, so this is safe. `params` is a Promise in Next 15.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";
import { MATCH_FIELDS, OPERATORS, type MatchField, type Operator } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const STRING_OPERATORS: Operator[] = ["contains", "equals", "starts_with", "ends_with", "regex"];
const AMOUNT_OPERATORS: Operator[] = ["gt", "lt", "equals"];

function operatorAllowed(field: MatchField, op: Operator): boolean {
  return field === "amount" ? AMOUNT_OPERATORS.includes(op) : STRING_OPERATORS.includes(op);
}

function normalizePriority(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100_000, Math.trunc(n)));
}

function validateValue(field: MatchField, op: Operator, value: string): string | null {
  if (!value) return "Enter a value to match on.";
  if (field === "amount") {
    const n = parseFloat(value.replace(/[$,\s]/g, ""));
    if (isNaN(n)) return "Enter a dollar amount, like 50 or 12.99.";
  }
  if (op === "regex") {
    try {
      new RegExp(value);
    } catch {
      return "That regular expression isn't valid.";
    }
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const existing = await prisma.rule.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Effective field/operator/value combine incoming edits with existing values
  // so we can cross-validate even when only one of them changes.
  const field = (body.matchField !== undefined
    ? String(body.matchField)
    : existing.matchField) as MatchField;
  const operator = (body.operator !== undefined
    ? String(body.operator)
    : existing.operator) as Operator;
  const value = body.value !== undefined ? String(body.value).trim() : existing.value;

  const data: Prisma.RuleUncheckedUpdateInput = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Give the rule a name." }, { status: 400 });
    data.name = name;
  }

  if (body.matchField !== undefined) {
    if (!MATCH_FIELDS.includes(field)) {
      return NextResponse.json({ error: "Pick a field to match on." }, { status: 400 });
    }
    data.matchField = field;
  }

  if (body.operator !== undefined) {
    if (!OPERATORS.includes(operator)) {
      return NextResponse.json({ error: "Pick a valid operator." }, { status: 400 });
    }
    data.operator = operator;
  }

  if (body.matchField !== undefined || body.operator !== undefined) {
    if (!operatorAllowed(field, operator)) {
      return NextResponse.json(
        { error: "That operator doesn't work with this field." },
        { status: 400 }
      );
    }
  }

  // Re-validate the value whenever it — or the field/operator it depends on — changes.
  if (body.value !== undefined || body.matchField !== undefined || body.operator !== undefined) {
    const err = validateValue(field, operator, value);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    if (body.value !== undefined) data.value = value;
  }

  if (body.categoryId !== undefined) {
    const categoryId = String(body.categoryId);
    if (!categoryId) {
      return NextResponse.json({ error: "Choose a category to assign." }, { status: 400 });
    }
    const category = await prisma.category.findFirst({ where: { id: categoryId, businessId: ctx.businessId } });
    if (!category) {
      return NextResponse.json({ error: "That category no longer exists." }, { status: 400 });
    }
    data.categoryId = categoryId;
  }

  if (body.priority !== undefined) data.priority = normalizePriority(body.priority);
  if (body.markTransfer !== undefined) data.markTransfer = Boolean(body.markTransfer);
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);

  const rule = await prisma.rule.update({ where: { id }, data, include: { category: true } });
  return NextResponse.json({ ok: true, rule });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const existing = await prisma.rule.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  await prisma.rule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
