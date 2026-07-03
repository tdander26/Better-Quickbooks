// Single-user PIN/password gate. The session cookie is a signed, expiring token:
//   value = "<issuedAtMs>.<hmacSHA256(issuedAtMs, key=ENCRYPTION_KEY)>"
// It can't be forged without ENCRYPTION_KEY, and it expires. We use Web Crypto
// (globalThis.crypto.subtle) so the SAME code runs in both the Edge middleware
// and Node route handlers.

export const SESSION_COOKIE = "bqb_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function keyMaterial(): string {
  return process.env.ENCRYPTION_KEY || "insecure-dev-key";
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyMaterial()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Buffer.from(sig).toString("hex");
}

/** Constant-time-ish string compare. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** True if the submitted password matches APP_PASSWORD. */
export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD || "";
  if (!expected) return false;
  return safeEqual(input, expected);
}

/** Mint a fresh session cookie value. */
export async function createSessionToken(): Promise<string> {
  const issued = Date.now().toString();
  const sig = await hmac(issued);
  return `${issued}.${sig}`;
}

/** Validate a session cookie value (signature + not expired). */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const issued = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const issuedMs = Number(issued);
  if (!Number.isFinite(issuedMs)) return false;
  if (Date.now() - issuedMs > SESSION_MAX_AGE_MS) return false;
  const expected = await hmac(issued);
  return safeEqual(sig, expected);
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_MS / 1000,
};
