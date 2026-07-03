// Chart-of-accounts (categories) collection endpoint.
//   GET  — every category, ordered for grouped display by section.
//   POST — create a top-level category { name, section, icon? }.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { SECTIONS, type Section } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const categories = await prisma.category.findMany({
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Give the category a name." }, { status: 400 });

  const section = String(body.section ?? "") as Section;
  if (!SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Pick a valid section." }, { status: 400 });
  }

  const icon = String(body.icon ?? "").trim();

  // Place new categories at the end of their section.
  const last = await prisma.category.findFirst({
    where: { section },
    orderBy: { sortOrder: "desc" },
  });
  const sortOrder = (last?.sortOrder ?? 0) + 1;

  try {
    const category = await prisma.category.create({
      data: { name, section, icon, parentId: null, sortOrder },
    });
    return NextResponse.json({ ok: true, category }, { status: 201 });
  } catch (e) {
    // @@unique([name, parentId]) — duplicate top-level name.
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: `A category named "${name}" already exists.` },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Couldn't create that category." }, { status: 400 });
  }
}
