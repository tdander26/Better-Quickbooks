"use client";

// Add / edit account dialog. Used from the accounts list (create) and from a
// single account page (edit, prefilled). On success it re-renders server data
// via router.refresh().
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { Plus, Pencil, Loader2, X, Landmark, CreditCard, Archive } from "lucide-react";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/types";
import { toDollars } from "@/lib/money";

export interface AccountFormValues {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  openingBalanceCents: number;
  openingDate: string; // ISO string; only the yyyy-MM-dd part is used
}

// Common institutions surfaced as free-text suggestions.
const INSTITUTION_SUGGESTIONS = [
  "Chase",
  "Ally",
  "Bank of America",
  "Wells Fargo",
  "Capital One",
  "American Express",
  "Citi",
  "Fidelity",
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function AccountForm({
  mode,
  account,
  triggerLabel,
  variant = "primary",
  triggerClassName,
}: {
  mode: "create" | "edit";
  account?: AccountFormValues;
  triggerLabel?: string;
  variant?: "primary" | "ghost";
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false); // archive in flight
  const [error, setError] = useState("");

  const [name, setName] = useState(account?.name ?? "");
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "bank");
  const [openingBalance, setOpeningBalance] = useState(
    account ? String(toDollars(account.openingBalanceCents)) : ""
  );
  const [openingDate, setOpeningDate] = useState(
    account ? account.openingDate.slice(0, 10) : todayISO()
  );

  const classification = type === "credit_card" ? "liability" : "asset";
  const working = saving || busy;

  function resetForm() {
    setName(account?.name ?? "");
    setInstitution(account?.institution ?? "");
    setType(account?.type ?? "bank");
    setOpeningBalance(account ? String(toDollars(account.openingBalanceCents)) : "");
    setOpeningDate(account ? account.openingDate.slice(0, 10) : todayISO());
    setError("");
  }

  function openDialog() {
    resetForm();
    setOpen(true);
  }

  function closeDialog() {
    if (working) return;
    setOpen(false);
  }

  // Escape to close + lock background scroll while the dialog is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !working) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, working]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Give the account a name.");
    if (!institution.trim()) return setError("Which bank or institution is this?");

    setSaving(true);
    const payload = {
      name: name.trim(),
      institution: institution.trim(),
      type,
      openingBalance: openingBalance.trim() === "" ? 0 : openingBalance,
      openingDate,
    };
    const url = mode === "edit" && account ? `/api/accounts/${account.id}` : "/api/accounts";
    const method = mode === "edit" ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSaving(false);

    if (!res || !res.ok) {
      const msg = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
      setError(msg || "Something went wrong. Please try again.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function onArchive() {
    if (!account) return;
    const ok = window.confirm(
      `Archive "${account.name}"? It's hidden from your accounts, but its transactions and history stay put.`
    );
    if (!ok) return;
    setError("");
    setBusy(true);
    const res = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setError("Couldn't archive this account. Please try again.");
      return;
    }
    setOpen(false);
    router.push("/accounts");
    router.refresh();
  }

  const TriggerIcon = mode === "edit" ? Pencil : Plus;
  const TypeIcon = type === "credit_card" ? CreditCard : Landmark;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={clsx(variant === "primary" ? "btn-primary" : "btn-ghost", triggerClassName)}
      >
        <TriggerIcon size={16} />
        {triggerLabel ?? (mode === "edit" ? "Edit" : "Add account")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={mode === "edit" ? "Edit account" : "Add an account"}
          onMouseDown={closeDialog}
        >
          <div
            className="card max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-b-none rounded-t-3xl p-5 sm:rounded-3xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
                  <TypeIcon size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold">
                    {mode === "edit" ? "Edit account" : "Add an account"}
                  </h2>
                  <p className="muted text-xs">
                    {mode === "edit"
                      ? "Update the details below."
                      : "Track a checking account or credit card."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Close"
                className="muted grid h-9 w-9 shrink-0 place-items-center rounded-xl transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Account name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Everyday Checking"
                  autoFocus
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Institution</span>
                <input
                  className="input"
                  list="account-institution-suggestions"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="Chase, Ally, …"
                />
                <datalist id="account-institution-suggestions">
                  {INSTITUTION_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Type</span>
                  <select
                    className="input"
                    value={type}
                    onChange={(e) => setType(e.target.value as AccountType)}
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ACCOUNT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <span className="muted text-xs">
                    Tracked as {classification === "asset" ? "an asset" : "a liability"}.
                  </span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Opening balance</span>
                  <div className="relative">
                    <span className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
                      $
                    </span>
                    <input
                      className="input pl-6"
                      inputMode="decimal"
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <span className="muted text-xs">
                    {type === "credit_card"
                      ? "Balance owed goes in as a negative number."
                      : "Balance on the opening date."}
                  </span>
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Opening date</span>
                <input
                  type="date"
                  className="input"
                  value={openingDate}
                  onChange={(e) => setOpeningDate(e.target.value)}
                />
              </label>

              {error && <p className="text-sm text-rose-500">{error}</p>}

              <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                {mode === "edit" && (
                  <button
                    type="button"
                    onClick={onArchive}
                    disabled={working}
                    className="btn-ghost mr-auto text-rose-600 dark:text-rose-400"
                  >
                    {busy ? <Loader2 className="animate-spin" size={16} /> : <Archive size={16} />}
                    Archive
                  </button>
                )}
                <button type="button" className="btn-ghost" onClick={closeDialog} disabled={working}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={working}>
                  {saving ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : mode === "edit" ? (
                    "Save changes"
                  ) : (
                    "Add account"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
