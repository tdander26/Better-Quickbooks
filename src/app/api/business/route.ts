// Create a new Business owned by the signed-in user. Does NOT use
// requireBusinessContext (a user creating their first business has no active
// business yet) — it authenticates directly.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createBusiness } from "@/lib/business";

export const runtime = "nodejs";

const schema = z.object({ name: z.string().trim().min(1, "Enter a business name").max(120) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const business = await createBusiness(session.user.id, parsed.data.name, "owner");
  return NextResponse.json(
    { ok: true, business: { id: business.id, name: business.name, slug: business.slug } },
    { status: 201 }
  );
}
