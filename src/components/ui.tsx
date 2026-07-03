// Shared, server-safe UI primitives (no client hooks) used across every page so
// the app stays visually consistent. Money rendering lives here too.
import { clsx } from "clsx";
import { formatMoney } from "@/lib/money";
import type { ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("card", className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="muted mt-0.5 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Colored money. Positive = green, negative = red, unless `plain`. */
export function Money({
  cents,
  className,
  plain = false,
  showCents = true,
}: {
  cents: number;
  className?: string;
  plain?: boolean;
  showCents?: boolean;
}) {
  const color = plain ? "" : cents < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";
  return (
    <span className={clsx("tabular-nums", color, className)}>
      {formatMoney(cents, { showCents })}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "red" | "amber" | "blue";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300",
    green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    red: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    blue: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  };
  return <span className={clsx("chip", tones[tone], className)}>{children}</span>;
}

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "green" | "red";
}) {
  const valueColor =
    tone === "green" ? "text-emerald-600 dark:text-emerald-400" : tone === "red" ? "text-rose-600 dark:text-rose-400" : "";
  return (
    <Card className="p-4">
      <div className="muted text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold tabular-nums", valueColor)}>{value}</div>
      {sub && <div className="muted mt-0.5 text-xs">{sub}</div>}
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="text-base font-medium">{title}</div>
      {hint && <div className="muted max-w-md text-sm">{hint}</div>}
      {action}
    </Card>
  );
}
