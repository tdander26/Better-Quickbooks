"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

// Wraps the app so client components can read/update the session (used by the
// business switcher's useSession().update()).
export function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
