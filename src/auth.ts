// Full Auth.js config (Node runtime only). Imported by route handlers, server
// components, and the tenant guards — NEVER by middleware (which must stay
// edge-safe and uses src/auth.config.ts instead).
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import authConfig from "@/auth.config";
import { prisma } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/password";
import { createBusiness } from "@/lib/business";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Ensure the shared demo user + business exist, and return the user. Used by the
 * password-free "demo" provider (gated by NEXT_PUBLIC_DEMO_LOGIN). Idempotent.
 */
async function ensureDemoUser() {
  const email = (process.env.SEED_USER_EMAIL || "demo@betterbooks.app").toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Random unusable password — demo users sign in via the provider, not a password.
    const rand = `demo-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    user = await prisma.user.create({
      data: { email, name: "Demo", passwordHash: await hashPassword(rand) },
    });
  }
  const membership = await prisma.membership.findFirst({ where: { userId: user.id } });
  if (!membership) {
    await createBusiness(user.id, "Demo Business", "owner");
  }
  return { id: user.id, email: user.email, name: user.name };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user?.passwordHash) return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    // Password-free preview sign-in. Off unless NEXT_PUBLIC_DEMO_LOGIN="1".
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: {},
      async authorize() {
        if (process.env.NEXT_PUBLIC_DEMO_LOGIN !== "1") return null;
        return ensureDemoUser();
      },
    }),
  ],
});
