"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Building2, Loader2, ChevronRight } from "lucide-react";
import type { BusinessLite } from "@/lib/nav-types";

export function BusinessPicker({ businesses }: { businesses: BusinessLite[] }) {
  const router = useRouter();
  const { update } = useSession();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function choose(id: string) {
    setBusyId(id);
    await update({ activeBusinessId: id });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {businesses.map((b) => (
        <button
          key={b.id}
          type="button"
          disabled={busyId !== null}
          onClick={() => choose(b.id)}
          className="card group flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
            {busyId === b.id ? <Loader2 size={18} className="animate-spin" /> : <Building2 size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{b.name}</div>
            <div className="muted text-xs capitalize">{b.role}</div>
          </div>
          <ChevronRight size={16} className="muted shrink-0 transition group-hover:translate-x-0.5" />
        </button>
      ))}
    </div>
  );
}
