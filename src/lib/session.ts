// Tenant context resolution — the core of multi-tenant isolation.
//
// Every API route and every Server Component read must go through one of these
// so that data is scoped to the caller's active Business. The active businessId
// travels in the session JWT, but is ALWAYS re-verified against a Membership row
// here — a stale or forged token can never grant access to a business the user
// doesn't belong to.
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import type { Business } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isBillingActive } from "@/lib/billing";

export type Role = "owner" | "admin" | "member";
const ROLE_RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export interface BusinessContext {
  user: { id: string; email: string; name: string | null };
  businessId: string;
  business: Business;
  role: Role;
}

type Resolved =
  | { kind: "unauth" }
  | { kind: "no_business"; userId: string }
  | { kind: "ok"; ctx: BusinessContext };

/** Resolve the signed-in user + active business, verifying membership. */
async function resolve(): Promise<Resolved> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { kind: "unauth" };

  const active = session.activeBusinessId ?? undefined;
  // Prefer the active business from the JWT, but only if the user is a member.
  // Fall back to their oldest membership (e.g. right after signup / stale token).
  const membership =
    (active
      ? await prisma.membership.findFirst({
          where: { userId, businessId: active },
          include: { business: true },
        })
      : null) ??
    (await prisma.membership.findFirst({
      where: { userId },
      include: { business: true },
      orderBy: { createdAt: "asc" },
    }));

  if (!membership) return { kind: "no_business", userId };

  return {
    kind: "ok",
    ctx: {
      user: { id: userId, email: session.user.email ?? "", name: session.user.name ?? null },
      businessId: membership.businessId,
      business: membership.business,
      role: membership.role as Role,
    },
  };
}

export function hasRole(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Guard for API route handlers. Returns the BusinessContext, or a NextResponse
 * (401/402/403) to return early. Usage:
 *   const ctx = await requireBusinessContext();
 *   if (ctx instanceof NextResponse) return ctx;
 */
export async function requireBusinessContext(opts?: {
  minRole?: Role;
  skipBilling?: boolean;
}): Promise<BusinessContext | NextResponse> {
  const r = await resolve();
  if (r.kind === "unauth") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (r.kind === "no_business")
    return NextResponse.json({ error: "No business", code: "no_business" }, { status: 403 });

  if (!opts?.skipBilling && !isBillingActive(r.ctx.business)) {
    return NextResponse.json({ error: "Subscription required", code: "billing" }, { status: 402 });
  }
  if (opts?.minRole && !hasRole(r.ctx.role, opts.minRole)) {
    return NextResponse.json({ error: "Insufficient permissions", code: "forbidden" }, { status: 403 });
  }
  return r.ctx;
}

/**
 * Guard for Server Components. Redirects instead of returning a Response, so it
 * always resolves to a usable BusinessContext.
 */
export async function getBusinessContext(opts?: {
  allowInactiveBilling?: boolean;
}): Promise<BusinessContext> {
  const r = await resolve();
  if (r.kind === "unauth") redirect("/login");
  if (r.kind === "no_business") redirect("/select-business");
  if (!opts?.allowInactiveBilling && !isBillingActive(r.ctx.business)) redirect("/settings/billing");
  return r.ctx;
}

/** Role assertion for privileged mutations. Returns a 403 Response or null. */
export function assertRole(ctx: BusinessContext, min: Role): NextResponse | null {
  return hasRole(ctx.role, min)
    ? null
    : NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
}
