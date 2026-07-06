// Single-category endpoint.
//   PATCH  — rename / re-section / re-icon a category.
//   DELETE — remove a category (system categories like "Uncategorized" are
//            protected). `params` is a Promise in Next 15 and must be awaited.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";
import { SECTIONS, type Section } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const existing = await prisma.category.findFirst({
    where: { id, businessId: ctx.businessId },
  });
  if (!existing) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data: Prisma.CategoryUpdateInput = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Give the category a name." }, { status: 400 });
    data.name = name;
  }

  if (body.section !== undefined) {
    const section = String(body.section) as Section;
    if (!SECTIONS.includes(section)) {
      return NextResponse.json({ error: "Pick a valid section." }, { status: 400 });
    }
    data.section = section;
  }

  if (body.icon !== undefined) {
    data.icon = String(body.icon).trim();
  }

  if (body.taxLine !== undefined) {
    data.taxLine = String(body.taxLine).trim();
  }

  if (body.color !== undefined) {
    data.color = String(body.color).trim();
  }

  try {
    // `existing` is already confirmed to belong to this business.
    const category = await prisma.category.update({ where: { id }, data });
    return NextResponse.json({ ok: true, category });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Another category already has that name." }, { status: 400 });
    }
    return NextResponse.json({ error: "Couldn't update that category." }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext({ minRole: "admin" });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const existing = await prisma.category.findFirst({
    where: { id, businessId: ctx.businessId },
  });
  if (!existing) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  if (existing.isSystem) {
    return NextResponse.json(
      { error: "This is a built-in category and can't be deleted." },
      { status: 400 }
    );
  }

  // Rules require a category (FK Restrict). Guide the user instead of 500-ing.
  const ruleCount = await prisma.rule.count({
    where: { categoryId: id, businessId: ctx.businessId },
  });
  if (ruleCount > 0) {
    return NextResponse.json(
      {
        error: `${ruleCount} rule${ruleCount === 1 ? "" : "s"} still point here. Update those rules first.`,
      },
      { status: 400 }
    );
  }

  try {
    // Any splits referencing this category are set to null (optional relation),
    // effectively becoming uncategorized — history is preserved.
    await prisma.category.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't delete that category." }, { status: 400 });
  }
}
