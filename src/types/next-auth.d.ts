// Module augmentation: add our custom fields to the Auth.js session + JWT.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    // The business the user is currently acting as (from the JWT). Always
    // re-verified server-side in src/lib/session.ts before it grants access.
    activeBusinessId?: string | null;
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    activeBusinessId?: string | null;
  }
}
