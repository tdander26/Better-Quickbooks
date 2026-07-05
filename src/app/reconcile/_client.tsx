"use client";

// The reconcile workspace for a single account. You enter the statement's end
// date and ending balance, then tick off the transactions that have cleared the
// bank. A live summary shows the cleared balance and the difference; when the
// difference hits $0 you can finish, which locks those transactions as
// "reconciled" and records a statement.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { format } from "date-fns";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import { Card, Money } from "@/components/ui";
import { formatMoney, toCents } from "@/lib/money";

export interface ReconcileTxn {
  id: string;
  postedAt: string; // ISO
  amountCents: number;
  payee: string;
  description: string;
  clearedStatus: "uncleared" | "cleared" | "reconciled";
}

interface AccountInfo {
  id: string;
  name: string;
  openingBalanceCents: number;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// End-of-day boundary for a yyyy-MM-dd string, so "postedAt <= endDate" includes
// everything that posted on the end date itself.
function endOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999`);
}

export function ReconcileWorkspace({
  account,
  transactions,
  lastReconciledAt,
}: {
  account: AccountInfo;
  transactions: ReconcileTxn[];
  lastReconciledAt: string | null;
}) {
  const router = useRouter();

  const [endDate, setEndDate] = useState(todayISO());
  const [endingBalance, setEndingBalance] = useState("");
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState<{ reconciledCount: number } | null>(null);

  // Which transactions are ticked as cleared. Seeded from the server state:
  // anything already 'cleared' or 'reconciled' starts checked.
  const [clearedIds, setClearedIds] = useState<Set<string>>(
    () => new Set(transactions.filter((t) => t.clearedStatus !== "uncleared").map((t) => t.id))
  );
  // In-flight toggles (disable the checkbox while its request is live).
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  const lockedIds = useMemo(
    () => new Set(transactions.filter((t) => t.clearedStatus === "reconciled").map((t) => t.id)),
    [transactions]
  );

  // Only transactions on or before the statement end date are part of this
  // reconciliation. Shown oldest-first, like a statement.
  const rows = useMemo(() => {
    const boundary = endOfDay(endDate).getTime();
    return transactions.filter((t) => new Date(t.postedAt).getTime() <= boundary);
  }, [transactions, endDate]);

  // clearedBalance = opening + Σ(checked amounts within the end date).
  const clearedBalanceCents = useMemo(() => {
    let sum = account.openingBalanceCents;
    for (const t of rows) if (clearedIds.has(t.id)) sum += t.amountCents;
    return sum;
  }, [rows, clearedIds, account.openingBalanceCents]);

  const hasBalance = endingBalance.trim() !== "";
  const statementCents = hasBalance ? toCents(endingBalance) : 0;
  const differenceCents = statementCents - clearedBalanceCents;
  const balanced = hasBalance && differenceCents === 0;

  const clearedCount = rows.filter((t) => clearedIds.has(t.id)).length;

  async function toggle(t: ReconcileTxn) {
    if (lockedIds.has(t.id) || pending.has(t.id)) return;
    const nextCleared = !clearedIds.has(t.id);

    // Optimistic update.
    setClearedIds((prev) => {
      const next = new Set(prev);
      if (nextCleared) next.add(t.id);
      else next.delete(t.id);
      return next;
    });
    setPending((prev) => new Set(prev).add(t.id));
    setError("");

    const res = await fetch("/api/reconcile/clear", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId: t.id, cleared: nextCleared }),
    }).catch(() => null);

    setPending((prev) => {
      const next = new Set(prev);
      next.delete(t.id);
      return next;
    });

    if (!res || !res.ok) {
      // Revert on failure.
      setClearedIds((prev) => {
        const next = new Set(prev);
        if (nextCleared) next.delete(t.id);
        else next.add(t.id);
        return next;
      });
      setError("Couldn't save that change. Please try again.");
    }
  }

  async function finish() {
    if (!balanced || finishing) return;
    setFinishing(true);
    setError("");

    const res = await fetch("/api/reconcile/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        endDate: endOfDay(endDate).toISOString(),
        endingBalanceCents: statementCents,
      }),
    }).catch(() => null);

    setFinishing(false);

    if (!res || !res.ok) {
      const msg = res
        ? ((await res.json().catch(() => ({}))) as { error?: string; difference?: number }).error
        : null;
      setError(msg || "Couldn't finish the reconciliation. Please try again.");
      return;
    }

    const data = (await res.json().catch(() => ({}))) as { reconciledCount?: number };
    setDone({ reconciledCount: data.reconciledCount ?? clearedCount });
    router.refresh();
  }

  // ------------------------------------------------------------- Success ---
  if (done) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={30} />
        </div>
        <div className="text-lg font-semibold">Reconciled</div>
        <p className="muted max-w-sm text-sm">
          {account.name} matches the statement ending {format(endOfDay(endDate), "MMM d, yyyy")} of{" "}
          {formatMoney(statementCents)}. {done.reconciledCount}{" "}
          {done.reconciledCount === 1 ? "transaction was" : "transactions were"} locked as reconciled.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <a href={`/accounts/${account.id}`} className="btn-ghost">
            View account
          </a>
          <a href="/reconcile" className="btn-primary">
            Reconcile another
          </a>
        </div>
      </Card>
    );
  }

  // ----------------------------------------------------------- Workspace ---
  return (
    <div className="flex flex-col gap-4">
      {/* Statement inputs */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Statement end date</span>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            {lastReconciledAt && (
              <span className="muted text-xs">
                Last reconciled {format(new Date(lastReconciledAt), "MMM d, yyyy")}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Statement ending balance</span>
            <div className="relative">
              <span className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
                $
              </span>
              <input
                className="input pl-6"
                inputMode="decimal"
                value={endingBalance}
                onChange={(e) => setEndingBalance(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <span className="muted text-xs">The balance printed on your bank statement.</span>
          </label>
        </div>
      </Card>

      {/* Sticky summary */}
      <div className="sticky top-2 z-10">
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="muted text-xs font-medium uppercase tracking-wide">Statement</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">
                {hasBalance ? formatMoney(statementCents) : "—"}
              </div>
            </div>
            <div>
              <div className="muted text-xs font-medium uppercase tracking-wide">Cleared</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">
                {formatMoney(clearedBalanceCents)}
              </div>
              <div className="muted text-xs">
                {clearedCount} of {rows.length} cleared
              </div>
            </div>
            <div className="col-span-2">
              <div className="muted text-xs font-medium uppercase tracking-wide">Difference</div>
              <div
                className={clsx(
                  "mt-0.5 text-2xl font-bold tabular-nums",
                  balanced
                    ? "text-emerald-600 dark:text-emerald-400"
                    : hasBalance
                    ? "text-rose-600 dark:text-rose-400"
                    : ""
                )}
              >
                {hasBalance ? formatMoney(differenceCents, { signed: true }) : "—"}
              </div>
              <div className="muted text-xs">
                {balanced
                  ? "Balanced — you're ready to finish."
                  : hasBalance
                  ? "Statement − cleared. Keep ticking until this is $0.00."
                  : "Enter the statement ending balance to begin."}
              </div>
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="btn-primary"
              disabled={!balanced || finishing}
              onClick={finish}
            >
              {finishing ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
              Finish reconciliation
            </button>
          </div>
        </Card>
      </div>

      {/* Transaction checklist */}
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <div className="muted p-8 text-center text-sm">
            No transactions posted on or before {format(endOfDay(endDate), "MMM d, yyyy")}.
          </div>
        ) : (
          <>
            {/* Desktop / tablet: table */}
            <div className="no-scrollbar hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="muted border-b text-left text-xs uppercase tracking-wide"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Payee</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-center font-medium">Cleared</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const checked = clearedIds.has(t.id);
                    const locked = lockedIds.has(t.id);
                    return (
                      <tr
                        key={t.id}
                        onClick={() => toggle(t)}
                        className={clsx(
                          "border-b last:border-0 transition",
                          locked
                            ? "opacity-70"
                            : "cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]",
                          checked && !locked && "bg-emerald-500/[0.06]"
                        )}
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                          {format(new Date(t.postedAt), "MMM d, yyyy")}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium">{t.payee || t.description || "—"}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <Money cents={t.amountCents} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ClearBox
                            checked={checked}
                            locked={locked}
                            busy={pending.has(t.id)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked rows */}
            <ul className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
              {rows.map((t) => {
                const checked = clearedIds.has(t.id);
                const locked = lockedIds.has(t.id);
                return (
                  <li
                    key={t.id}
                    onClick={() => toggle(t)}
                    className={clsx(
                      "flex items-center gap-3 px-4 py-3",
                      locked ? "opacity-70" : "cursor-pointer",
                      checked && !locked && "bg-emerald-500/[0.06]"
                    )}
                  >
                    <ClearBox checked={checked} locked={locked} busy={pending.has(t.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {t.payee || t.description || "—"}
                      </div>
                      <div className="muted tabular-nums text-xs">
                        {format(new Date(t.postedAt), "MMM d, yyyy")}
                      </div>
                    </div>
                    <Money cents={t.amountCents} className="shrink-0" />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function ClearBox({
  checked,
  locked,
  busy,
}: {
  checked: boolean;
  locked: boolean;
  busy: boolean;
}) {
  return (
    <span
      className={clsx(
        "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition",
        checked
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-[var(--border)] bg-transparent"
      )}
      aria-hidden="true"
    >
      {busy ? (
        <Loader2 className="animate-spin" size={14} />
      ) : locked ? (
        <Lock size={13} />
      ) : checked ? (
        <CheckCircle2 size={16} />
      ) : null}
    </span>
  );
}
