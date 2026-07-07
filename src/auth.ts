// Full Auth.js config (Node runtime only). Imported by route handlers, server
// components, and the tenant guards — NEVER by middleware (which must stay
// edge-safe and uses src/auth.config.ts instead).
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import authConfig from "@/auth.config";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { authorizeDemo } from "@/lib/demo-auth";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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
    // Password-free preview sign-in. Off unless NEXT_PUBLIC_DEMO_LOGIN="1", and
    // it can ONLY ever sign into the isolated demo identity — never a real
    // account. See src/lib/demo-auth.ts.
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: {},
      authorize: authorizeDemo,
    }),
  ],
});
