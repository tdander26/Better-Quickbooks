"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Building2, Loader2, ChevronLeft } from "lucide-react";

export default function NewBusinessPage() {
  const router = useRouter();
  const { update } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Couldn't create the business.");
      setLoading(false);
      return;
    }
    // Make the new business active, then head to its dashboard.
    await update({ activeBusinessId: data.business.id });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="card w-full max-w-sm p-7">
        <Link
          href="/select-business"
          className="muted mb-3 inline-flex items-center gap-1 text-sm transition hover:text-[var(--text)]"
        >
          <ChevronLeft size={16} /> Back
        </Link>
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
            <Building2 size={26} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">New business</h1>
            <p className="muted text-sm">A fresh, isolated set of books</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            type="text"
            placeholder="Business name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
          {error && <p className="text-center text-sm text-rose-500">{error}</p>}
          <button className="btn-primary" disabled={loading || !name.trim()}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : "Create business"}
          </button>
        </form>
      </div>
    </div>
  );
}
