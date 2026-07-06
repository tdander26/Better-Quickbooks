"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { clsx } from "clsx";
import { Building2, Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import type { BusinessLite } from "@/lib/nav-types";

export function BusinessSwitcher({
  businesses,
  activeBusinessId,
}: {
  businesses: BusinessLite[];
  activeBusinessId: string | null;
}) {
  const { update } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = businesses.find((b) => b.id === activeBusinessId) ?? businesses[0] ?? null;

  async function switchTo(id: string) {
    if (id === active?.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    // Rewrite the session JWT's activeBusinessId (jwt callback, trigger "update").
    // Membership is re-verified server-side on every request regardless.
    await update({ activeBusinessId: id });
    setBusy(false);
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Building2 size={16} />}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold">{active?.name ?? "Select business"}</div>
          <div className="muted truncate text-xs capitalize">{active?.role ?? ""}</div>
        </div>
        <ChevronsUpDown size={15} className="muted shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border bg-[var(--bg)] py-1 shadow-lg"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="max-h-64 overflow-y-auto">
              {businesses.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => switchTo(b.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {b.id === active?.id && <Check size={15} className="shrink-0 text-brand-600 dark:text-brand-400" />}
                </button>
              ))}
            </div>
            <Link
              href="/business/new"
              onClick={() => setOpen(false)}
              className={clsx(
                "flex items-center gap-2 border-t px-3 py-2 text-sm font-medium text-brand-600 transition hover:bg-black/5 dark:text-brand-400 dark:hover:bg-white/5"
              )}
              style={{ borderColor: "var(--border)" }}
            >
              <Plus size={15} />
              Create business
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
