// Rules collection endpoint.
//   GET  -> list every rule (in evaluation order: priority asc, then oldest first)
//   POST -> create a new auto-categorization rule
// These rules feed the categorize() engine used on import and on "Re-apply".
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { MATCH_FIELDS, OPERATORS, type MatchField, type Operator } from "@/lib/types";

export const runtime = "nodejs";

// The categorize() engine treats amount fields numerically (gt/lt/equals) and
// every other field as text — keep validation in step with that.
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

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const rules = await prisma.rule.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    include: { category: true },
  });
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Give the rule a name." }, { status: 400 });

  const matchField = String(body.matchField ?? "") as MatchField;
  if (!MATCH_FIELDS.includes(matchField)) {
    return NextResponse.json({ error: "Pick a field to match on." }, { status: 400 });
  }

  const operator = String(body.operator ?? "") as Operator;
  if (!OPERATORS.includes(operator)) {
    return NextResponse.json({ error: "Pick a valid operator." }, { status: 400 });
  }
  if (!operatorAllowed(matchField, operator)) {
    return NextResponse.json(
      { error: "That operator doesn't work with this field." },
      { status: 400 }
    );
  }

  const value = String(body.value ?? "").trim();
  const valueError = validateValue(matchField, operator, value);
  if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });

  const categoryId = String(body.categoryId ?? "");
  if (!categoryId) return NextResponse.json({ error: "Choose a category to assign." }, { status: 400 });
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return NextResponse.json({ error: "That category no longer exists." }, { status: 400 });

  const priority = normalizePriority(body.priority);
  const markTransfer = Boolean(body.markTransfer);
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

  const rule = await prisma.rule.create({
    data: { name, priority, enabled, matchField, operator, value, categoryId, markTransfer },
    include: { category: true },
  });

  return NextResponse.json({ ok: true, rule }, { status: 201 });
}
