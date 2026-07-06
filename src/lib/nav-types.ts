// Small serializable shapes shared between the server layout and client shell.
import type { Role } from "@/lib/session";

export interface BusinessLite {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface ShellData {
  user: { email: string; name: string | null };
  businesses: BusinessLite[];
  activeBusinessId: string | null;
}
