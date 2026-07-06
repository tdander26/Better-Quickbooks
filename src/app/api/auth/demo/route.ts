// Optional password-free "demo" sign-in, for sharing a read/write preview of the
// app without having to hand out the real password. DISABLED by default — it only
// works when NEXT_PUBLIC_DEMO_LOGIN="1" is set in the environment. Turn it off
// (unset the var + redeploy) to require the password again.
import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  if (process.env.NEXT_PUBLIC_DEMO_LOGIN !== "1") {
    return NextResponse.json({ error: "Demo sign-in is disabled." }, { status: 403 });
  }
  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return res;
}
