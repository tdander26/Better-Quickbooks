// Renders a transaction's smart badges. Server-safe (no hooks) so it works in
// server components (account register) and inside the client transactions table.
import { clsx } from "clsx";
import type { Badge } from "@/lib/badges";

const TONE: Record<string, string> = {
  brand: "bg-brand-500/15 text-brand-700 dark:text-brand-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  blue: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  neutral: "bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300",
};

export function TxnBadges({ badges, className }: { badges: Badge[]; className?: string }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className={clsx("inline-flex flex-wrap items-center gap-1", className)}>
      {badges.map((b) => (
        <span key={b.key} title={b.title} className={clsx("chip", TONE[b.tone])}>
          {b.label}
        </span>
      ))}
    </span>
  );
}
