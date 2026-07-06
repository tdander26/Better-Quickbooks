// Auth.js route handler (sign-in, sign-out, session, csrf, callbacks).
import { handlers } from "@/auth";

export const runtime = "nodejs";
export const { GET, POST } = handlers;
