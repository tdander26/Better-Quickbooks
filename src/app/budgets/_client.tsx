"use client";

// Interactive budget list. Each row shows a category's spend-vs-budget with a
// progress bar and an inline dollar input for its monthly target. Editing the
// amount (blur or Enter) POSTs to /api/budgets and optimistically re-renders the
// bar; setting it to empty/0 clears the budget. router.refresh() then reconciles
// the server-computed totals in the stat tiles above.
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { Loader2, AlertTriangle } from "lucide-react";
import { CategoryIcon } from "@/lib/icons";
import { EmptyState } from "@/components/ui";
import { toCents, formatMoney } from "@/lib/money";

export interface BudgetLineDTO {
  categoryId: string;
  name: string;
  icon: string;
  budgetCents: number;
  actualCents: number;
}

/** Dollars string for the input, e.g. 12000 -> "120.00"; 0 -> "". */
function centsToInput(cents: number): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2);
}

export function BudgetList({ lines, month }: { lines: BudgetLineDTO[]; month: string }) {
  if (lines.length === 0) {
    return (
      <EmptyState
        title="No budgets for this month yet"
        hint="Once you have spending in a month, your expense categories show up here so you can set a target for each."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {lines.map((line) => (
        <BudgetRow key={line.categoryId} line={line} month={month} />
      ))}
    </div>
  );
}

function BudgetRow({ line, month }: { line: BudgetLineDTO; month: string }) {
  const router = useRouter();
  // Optimistic budget so the bar/remaining update instantly on save.
  const [budgetCents, setBudgetCents] = useState(line.budgetCents);
  const [value, setValue] = useState(centsToInput(line.budgetCents));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep in sync if the server data changes underneath us (after refresh).
  useEffect(() => {
    setBudgetCents(line.budgetCents);
    setValue(centsToInput(line.budgetCents));
  }, [line.budgetCents]);

  const actual = line.actualCents;
  const hasBudget = budgetCents > 0;
  const remaining = budgetCents - actual;
  const pct = hasBudget ? actual / budgetCents : 0;
  const over = pct > 1;
  const warn = pct > 0.8 && pct <= 1;

  async function save() {
    const next = value.trim() ? toCents(value) : 0;
    if (next === budgetCents) {
      // No change — normalize the display and bail.
      setValue(centsToInput(budgetCents));
      return;
    }
    setBusy(true);
    setError("");
    const prev = budgetCents;
    setBudgetCents(next); // optimistic
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryId: line.categoryId, month, amountCents: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setBudgetCents(prev); // rollback
      setValue(centsToInput(prev));
      setError((data as { error?: string })?.error || "Couldn't save that budget.");
      return;
    }
    setValue(centsToInput(next));
    router.refresh();
  }

  return (
    <div className="card p-3.5 sm:p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300">
          <CategoryIcon name={line.icon} size={17} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{line.name}</div>
          <div className="muted mt-0.5 text-xs tabular-nums">
            {hasBudget ? (
              <>
                <span className={clsx(over && "text-rose-500", warn && "text-amber-500")}>
                  {formatMoney(actual)}
                </span>{" "}
                spent of {formatMoney(budgetCents)}
              </>
            ) : (
              <>{formatMoney(actual)} spent · no budget</>
            )}
          </div>
        </div>

        {/* Dollar input for the monthly target. */}
        <div className="relative shrink-0">
          <span className="muted pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm">
            $
          </span>
          <input
            ref={inputRef}
            inputMode="decimal"
            className="input h-9 w-28 pl-6 pr-2 text-right tabular-nums"
            value={value}
            placeholder="Set budget"
            aria-label={`Monthly budget for ${line.name}`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                inputRef.current?.blur();
              } else if (e.key === "Escape") {
                setValue(centsToInput(budgetCents));
                setError("");
                inputRef.current?.blur();
              }
            }}
            onBlur={save}
            disabled={busy}
          />
          {busy && (
            <Loader2
              size={14}
              className="muted absolute right-2 top-1/2 -translate-y-1/2 animate-spin"
            />
          )}
        </div>
      </div>

      {/* Progress bar (only meaningful when a budget exists). */}
      {hasBudget && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className={clsx(
                "h-full rounded-full transition-all",
                over ? "bg-rose-500" : warn ? "bg-amber-500" : "bg-brand-500"
              )}
              style={{ width: `${Math.max(2, Math.min(100, Math.round(pct * 100)))}%` }}
            />
          </div>
          <span
            className={clsx(
              "shrink-0 text-xs font-medium tabular-nums",
              remaining < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {remaining < 0
              ? `${formatMoney(-remaining)} over`
              : `${formatMoney(remaining)} left`}
          </span>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-500">
          <AlertTriangle size={13} /> {error}
        </p>
      )}
    </div>
  );
}
