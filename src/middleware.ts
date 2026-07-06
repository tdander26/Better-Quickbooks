// Auth gate (Edge runtime). Uses the edge-safe Auth.js config (no Prisma) to
// verify the session JWT. Public paths are allowlisted; everything else requires
// a signed-in user. Deep authorization (business membership, role, subscription)
// happens server-side in src/lib/session.ts — this is just the cheap edge check.
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/invite",
  "/api/auth", // NextAuth routes + our /api/auth/register + /api/auth/demo
  "/api/stripe/webhook",
  "/api/health",
  "/manifest.webmanifest",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (req.auth) return NextResponse.next();

  // API calls get a 401; page navigations redirect to the login screen.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
});

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};
