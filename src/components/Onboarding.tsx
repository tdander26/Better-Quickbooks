"use client";

// Shown on the dashboard when a business has no accounts yet. Guides the user to
// connect a bank feed or add their first account. (A default chart of accounts +
// rules is already seeded for every new business.)
import Link from "next/link";
import { Sparkles, Building2, Landmark } from "lucide-react";

export function Onboarding() {
  return (
    <div className="card p-6 sm:p-8">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400">
            <Sparkles size={22} />
          </span>
          <div>
            <div className="text-lg font-semibold">Welcome to Better Books 👋</div>
            <div className="muted mt-0.5 max-w-lg text-sm">
              This business is ready to go. Connect a bank feed to pull in transactions
              automatically, or add an account by hand to start tracking balances.
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Link href="/settings" className="btn-primary">
          <Building2 size={16} />
          Connect a bank
        </Link>
        <Link href="/accounts" className="btn-ghost">
          <Landmark size={16} />
          Add an account
        </Link>
      </div>
    </div>
  );
}
