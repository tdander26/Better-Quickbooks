// Edge-safe Auth.js config. Contains ONLY things that run on the Edge runtime:
// session strategy + JWT/session callbacks. NO Prisma, NO Node crypto, NO
// providers that need them. The middleware imports this to verify the session
// JWT; the full config (src/auth.ts) merges this and adds the Prisma adapter +
// Credentials provider for Node route handlers.
import type { NextAuthConfig } from "next-auth";

export default {
  // Trust the deploy host's headers (required on Netlify / any non-Vercel host,
  // and for local `next start`). Auth.js otherwise rejects requests as UntrustedHost.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [], // real providers are added in src/auth.ts (they need Node)
  callbacks: {
    jwt({ token, user, trigger, session }) {
      // On sign-in, stamp the user id into the token.
      if (user) token.uid = user.id;
      // Business switcher calls update({ activeBusinessId }) -> rewrite the token
      // without a re-login. Membership is re-verified server-side on every request.
      if (trigger === "update" && session && "activeBusinessId" in session) {
        token.activeBusinessId = session.activeBusinessId as string | null;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      session.activeBusinessId = (token.activeBusinessId as string | null | undefined) ?? null;
      return session;
    },
  },
} satisfies NextAuthConfig;
