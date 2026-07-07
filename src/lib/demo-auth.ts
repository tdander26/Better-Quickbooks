// Password-free "demo" sign-in, isolated from real accounts.
//
// SECURITY: the demo identity is a FIXED, throwaway account — deliberately
// decoupled from SEED_USER_EMAIL (which in production points at the real owner).
// Even if NEXT_PUBLIC_DEMO_LOGIN is accidentally left "1" in a production build,
// the worst an anonymous visitor can reach is an empty "Demo Business" — never
// the owner's books. authorizeDemo() additionally refuses to return anything but
// the demo identity, as defense in depth.
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createBusiness } from "@/lib/business";

/** Fixed demo identity. NOT read from SEED_USER_EMAIL — that is the point. */
export const DEMO_EMAIL = "demo@betterbooks.app";

export function demoLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_LOGIN === "1";
}

/** Create (idempotently) the throwaway demo user + its own Demo Business. */
async function ensureDemoUser() {
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    // Random unusable password — demo users sign in via the provider, not a password.
    const rand = `demo-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    user = await prisma.user.create({
      data: { email: DEMO_EMAIL, name: "Demo", passwordHash: await hashPassword(rand) },
    });
  }
  const membership = await prisma.membership.findFirst({ where: { userId: user.id } });
  if (!membership) {
    await createBusiness(user.id, "Demo Business", "owner");
  }
  return user;
}

type SessionUser = { id: string; email: string; name: string | null };

/**
 * Authorize the password-free demo provider. Returns a session user ONLY when
 * demo login is explicitly enabled AND the resolved account is the dedicated
 * demo identity. Returns null otherwise — it will never surface a real account.
 */
export async function authorizeDemo(): Promise<SessionUser | null> {
  if (!demoLoginEnabled()) return null;
  const user = await ensureDemoUser();
  // Defense in depth: refuse anything that isn't the throwaway demo identity.
  if (user.email !== DEMO_EMAIL) return null;
  return { id: user.id, email: user.email, name: user.name };
}
