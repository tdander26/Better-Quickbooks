"use client";

// Shown on the dashboard when the database is empty (e.g. a fresh deployment).
// Lets the user load demo data with one click — no terminal needed — or head to
// Settings to connect their real SimpleFIN feed.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Loader2, Building2 } from "lucide-react";

export function Onboarding() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadDemo() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/seed", { method: "POST" });
    setLoading(false);
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.message || "Could not load demo data.");
    }
  }

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
              Your books are empty. Load a set of realistic demo transactions to explore every
              feature, or connect your real bank feed to get started for real.
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button className="btn-primary" onClick={loadDemo} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          Load demo data
        </button>
        <Link href="/settings" className="btn-ghost">
          <Building2 size={16} />
          Connect a bank
        </Link>
      </div>
      {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
    </div>
  );
}
