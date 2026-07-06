"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className={className ?? "btn-ghost text-rose-600 dark:text-rose-400"}
    >
      <LogOut size={16} />
      Sign out
    </button>
  );
}
