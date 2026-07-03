"use client";

// The interactive transactions register. Everything the user does — searching,
// filtering, inline categorizing, splitting, transfers, bulk edits, manual
// entry — happens here against the /api/transactions endpoints. After every
// successful mutation we router.refresh() so the server data re-renders; local
// optimistic state keeps categorizing feeling instant.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { parseISO, format } from "date-fns";
import {
  Search,
  Plus,
  X,
  Check,
  CheckCheck,
  Loader2,
  MoreHorizontal,
  Layers,
  Split as SplitIcon,
  Repeat,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  SECTION_LABELS,
  UNCATEGORIZED,
  TRANSFER_CATEGORY,
  type Section,
} from "@/lib/types";
import { formatMoney, toCents } from "@/lib/money";
import { Money, EmptyState } from "@/components/ui";

// ---------------------------------------------------------------------------
// Shared shapes (also consumed by page.tsx)
// ---------------------------------------------------------------------------

export interface TxnSplit {
  id: string;
  categoryId: string | null;
  amountCents: number;
  memo: string;
}

export interface TxnRow {
  id: string;
  accountId: string;
  accountName: string;
  postedAt: string; // ISO
  amountCents: number;
  payee: string;
  description: string;
  memo: string;
  notes: string;
  pending: boolean;
  reviewed: boolean;
  transferId: string | null;
  splits: TxnSplit[];
}

export interface CategoryOption {
  id: string;
  name: string;
  section: string;
  color: string;
}

export interface AccountOption {
  id: string;
  name: string;
  institution: string;
}

export interface TxnFilters {
  q: string;
  account: string;
  category: string;
  filter: string; // all | uncategorized | needs_review | reviewed | pending
  start: string;
  end: string;
}

export interface TableProps {
  transactions: TxnRow[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  filters: TxnFilters;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECTION_ORDER: Section[] = [
  "income",
  "expense",
  "transfer",
  "asset",
  "liability",
  "equity",
];

interface CatGroup {
  label: string;
  cats: CategoryOption[];
}

function groupCategories(categories: CategoryOption[], excludeId?: string): CatGroup[] {
  return SECTION_ORDER.map((section) => ({
    label: SECTION_LABELS[section],
    cats: categories
      .filter((c) => c.section === section && c.id !== excludeId)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.cats.length > 0);
}

function CategoryOptionGroups({ groups }: { groups: CatGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

async function api(url: string, method: string, body?: unknown): Promise<Response | null> {
  return fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch(() => null);
}

async function readError(res: Response | null): Promise<string> {
  if (!res) return "Network error — please try again.";
  try {
    const j = (await res.json()) as { error?: string };
    return (typeof j?.error === "string" && j.error) || "Something went wrong.";
  } catch {
    return "Something went wrong.";
  }
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TransactionsTable({
  transactions,
  accounts,
  categories,
  filters,
  page,
  pageSize,
  total,
  totalPages,
}: TableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local mirror of server rows for optimistic updates.
  const [rows, setRows] = useState<TxnRow[]>(transactions);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Modals
  const [addOpen, setAddOpen] = useState(false);
  const [splitFor, setSplitFor] = useState<TxnRow | null>(null);
  const [detailsFor, setDetailsFor] = useState<TxnRow | null>(null);
  const [actionsFor, setActionsFor] = useState<TxnRow | null>(null);

  // Toast
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search box (debounced -> URL)
  const [search, setSearch] = useState(filters.q);

  const uncategorizedId = useMemo(
    () => categories.find((c) => c.name === UNCATEGORIZED)?.id ?? "",
    [categories]
  );
  const transferCatId = useMemo(
    () => categories.find((c) => c.name === TRANSFER_CATEGORY)?.id ?? "",
    [categories]
  );
  const groupsForAssign = useMemo(
    () => groupCategories(categories, uncategorizedId),
    [categories, uncategorizedId]
  );
  const groupsAll = useMemo(() => groupCategories(categories), [categories]);
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // Re-sync local state whenever fresh server data arrives.
  useEffect(() => {
    setRows(transactions);
    setSelected((prev) => {
      const ids = new Set(transactions.map((t) => t.id));
      const next = new Set<string>();
      prev.forEach((id) => ids.has(id) && next.add(id));
      return next;
    });
  }, [transactions]);

  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);

  // Debounce the search box into the URL.
  useEffect(() => {
    const h = setTimeout(() => {
      if (search !== filters.q) navigate({ q: search, page: "1" });
    }, 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function flash(msg: string, tone: "ok" | "err") {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  function markSaving(id: string, on: boolean) {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // --- URL navigation ------------------------------------------------------
  function navigate(next: Partial<Record<keyof TxnFilters | "page", string>>) {
    const merged = {
      q: filters.q,
      account: filters.account,
      category: filters.category,
      filter: filters.filter,
      start: filters.start,
      end: filters.end,
      page: String(page),
      ...next,
    };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.account) params.set("account", merged.account);
    if (merged.category) params.set("category", merged.category);
    if (merged.filter && merged.filter !== "all") params.set("filter", merged.filter);
    if (merged.start) params.set("start", merged.start);
    if (merged.end) params.set("end", merged.end);
    if (merged.page && merged.page !== "1") params.set("page", merged.page);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/transactions?${qs}` : "/transactions"));
  }

  function clearAllFilters() {
    setSearch("");
    startTransition(() => router.push("/transactions"));
  }

  // --- Mutations -----------------------------------------------------------
  async function pickCategory(t: TxnRow, categoryId: string) {
    const current = t.splits.length === 1 ? t.splits[0].categoryId ?? uncategorizedId : "";
    if (categoryId === current) return;
    markSaving(t.id, true);
    setRows((prev) =>
      prev.map((r) =>
        r.id === t.id
          ? {
              ...r,
              reviewed: true,
              splits: [
                {
                  id: r.splits[0]?.id ?? "optimistic",
                  categoryId: categoryId || null,
                  amountCents: r.amountCents,
                  memo: r.splits[0]?.memo ?? "",
                },
              ],
            }
          : r
      )
    );
    const res = await api(`/api/transactions/${t.id}`, "PATCH", { categoryId });
    markSaving(t.id, false);
    if (!res || !res.ok) {
      setRows(transactions);
      flash(await readError(res), "err");
      return;
    }
    flash("Categorized ✓", "ok");
    refresh();
  }

  async function toggleReviewed(t: TxnRow) {
    const next = !t.reviewed;
    markSaving(t.id, true);
    setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, reviewed: next } : r)));
    const res = await api(`/api/transactions/${t.id}`, "PATCH", { reviewed: next });
    markSaving(t.id, false);
    if (!res || !res.ok) {
      setRows(transactions);
      flash(await readError(res), "err");
      return;
    }
    refresh();
  }

  async function markTransfer(t: TxnRow) {
    markSaving(t.id, true);
    setRows((prev) =>
      prev.map((r) =>
        r.id === t.id
          ? {
              ...r,
              reviewed: true,
              transferId: r.transferId ?? "pending",
              splits: [
                {
                  id: r.splits[0]?.id ?? "optimistic",
                  categoryId: transferCatId || null,
                  amountCents: r.amountCents,
                  memo: "",
                },
              ],
            }
          : r
      )
    );
    const res = await api(`/api/transactions/${t.id}`, "PATCH", { transfer: true });
    markSaving(t.id, false);
    if (!res || !res.ok) {
      setRows(transactions);
      flash(await readError(res), "err");
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { linked?: boolean };
    flash(j?.linked ? "Linked transfer ✓" : "Marked as transfer", "ok");
    refresh();
  }

  async function unlinkTransfer(t: TxnRow) {
    markSaving(t.id, true);
    setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, transferId: null } : r)));
    const res = await api(`/api/transactions/${t.id}`, "PATCH", { transfer: false });
    markSaving(t.id, false);
    if (!res || !res.ok) {
      setRows(transactions);
      flash(await readError(res), "err");
      return;
    }
    flash("Transfer unlinked", "ok");
    refresh();
  }

  async function deleteTxn(t: TxnRow) {
    markSaving(t.id, true);
    setRows((prev) => prev.filter((r) => r.id !== t.id));
    const res = await api(`/api/transactions/${t.id}`, "DELETE");
    markSaving(t.id, false);
    if (!res || !res.ok) {
      setRows(transactions);
      flash(await readError(res), "err");
      return;
    }
    flash("Transaction deleted", "ok");
    refresh();
  }

  async function bulk(action: string, categoryId?: string) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    const res = await api("/api/transactions/bulk", "POST", { ids, action, categoryId });
    setBulkBusy(false);
    if (!res || !res.ok) {
      flash(await readError(res), "err");
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { updated?: number; skipped?: number };
    setSelected(new Set());
    const verb =
      action === "setCategory"
        ? "Categorized"
        : action === "markReviewed"
        ? "Marked reviewed"
        : action === "unreview"
        ? "Marked unreviewed"
        : "Marked as transfer";
    let msg = `${verb} ${j?.updated ?? ids.length}`;
    if (j?.skipped) msg += ` · ${j.skipped} skipped`;
    flash(msg, "ok");
    refresh();
  }

  // Modal submit handlers (return an error string, or null on success).
  async function submitCreate(payload: unknown): Promise<string | null> {
    const res = await api("/api/transactions", "POST", payload);
    if (!res || !res.ok) return readError(res);
    flash("Transaction added", "ok");
    refresh();
    return null;
  }

  async function submitSplits(id: string, splits: unknown): Promise<string | null> {
    const res = await api(`/api/transactions/${id}`, "PATCH", { splits });
    if (!res || !res.ok) return readError(res);
    flash("Splits saved ✓", "ok");
    refresh();
    return null;
  }

  async function submitDetails(
    id: string,
    data: { payee: string; description: string; notes: string }
  ): Promise<string | null> {
    const res = await api(`/api/transactions/${id}`, "PATCH", data);
    if (!res || !res.ok) return readError(res);
    flash("Details saved", "ok");
    refresh();
    return null;
  }

  // --- Selection -----------------------------------------------------------
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const someChecked = selected.size > 0 && !allChecked;

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasActiveFilters =
    !!filters.q ||
    !!filters.account ||
    !!filters.category ||
    (filters.filter && filters.filter !== "all") ||
    !!filters.start ||
    !!filters.end;

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  // --- Render helpers ------------------------------------------------------
  function isTransfer(t: TxnRow): boolean {
    if (t.transferId) return true;
    return t.splits.length === 1 && !!transferCatId && t.splits[0].categoryId === transferCatId;
  }

  function renderCategoryControl(t: TxnRow, full: boolean): ReactNode {
    if (t.splits.length > 1) {
      return (
        <button
          type="button"
          onClick={() => setSplitFor(t)}
          className={clsx(
            "chip bg-sky-500/15 text-sky-700 transition hover:brightness-105 dark:text-sky-300",
            full && "w-full justify-center"
          )}
        >
          <Layers size={13} /> {t.splits.length} splits
        </button>
      );
    }
    const split = t.splits[0];
    const value = split?.categoryId ?? uncategorizedId;
    const isUnc = !split?.categoryId || split.categoryId === uncategorizedId;
    const busy = savingIds.has(t.id);
    return (
      <div className={clsx("flex items-center gap-1.5", full && "w-full")}>
        <select
          value={value}
          disabled={busy}
          onChange={(e) => pickCategory(t, e.target.value)}
          aria-label="Category"
          className={clsx(
            "min-w-0 truncate rounded-lg border py-1.5 pl-2.5 pr-7 text-sm outline-none transition focus:ring-2 focus:ring-brand-500/40",
            full ? "w-full" : "max-w-[210px]",
            isUnc
              ? "border-amber-400/60 text-amber-700 dark:text-amber-300"
              : "font-medium"
          )}
          style={{
            background: "var(--card)",
            ...(isUnc ? {} : { borderColor: "var(--border)" }),
          }}
        >
          <option value={uncategorizedId || ""}>Uncategorized</option>
          <CategoryOptionGroups groups={groupsForAssign} />
        </select>
        {t.transferId && (
          <Repeat size={14} className="shrink-0 text-sky-500" aria-label="Transfer" />
        )}
        {busy && <Loader2 size={14} className="muted shrink-0 animate-spin" />}
      </div>
    );
  }

  function renderReviewToggle(t: TxnRow): ReactNode {
    const on = t.reviewed;
    return (
      <button
        type="button"
        onClick={() => toggleReviewed(t)}
        disabled={savingIds.has(t.id)}
        aria-pressed={on}
        title={on ? "Reviewed — click to unmark" : "Mark reviewed"}
        className={clsx(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition",
          on
            ? "border-transparent bg-brand-500/15 text-brand-600 dark:text-brand-400"
            : "muted hover:bg-black/5 dark:hover:bg-white/5"
        )}
        style={on ? undefined : { borderColor: "var(--border)" }}
      >
        <Check size={16} />
      </button>
    );
  }

  function renderMoreButton(t: TxnRow): ReactNode {
    return (
      <button
        type="button"
        onClick={() => setActionsFor(t)}
        title="More actions"
        aria-label="More actions"
        className="muted grid h-8 w-8 shrink-0 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/5"
      >
        <MoreHorizontal size={16} />
      </button>
    );
  }

  const chips: { key: string; label: string; value: string }[] = [
    { key: "all", label: "All", value: "all" },
    { key: "uncategorized", label: "Uncategorized", value: "uncategorized" },
    { key: "needs_review", label: "Needs review", value: "needs_review" },
    { key: "pending", label: "Pending", value: "pending" },
  ];

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- Toolbar */}
      <div className="card space-y-3 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ q: search, page: "1" });
            }}
          >
            <Search
              size={16}
              className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              className="input pl-9"
              placeholder="Search payee, description or memo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputMode="search"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  navigate({ q: "", page: "1" });
                }}
                aria-label="Clear search"
                className="muted absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X size={14} />
              </button>
            )}
          </form>

          <button type="button" className="btn-primary shrink-0" onClick={() => setAddOpen(true)}>
            <Plus size={16} />
            Add transaction
          </button>
        </div>

        {/* Filter chips */}
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {chips.map((c) => {
            const active = (filters.filter || "all") === c.value;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => navigate({ filter: c.value, page: "1" })}
                className={clsx(
                  "chip shrink-0 border transition",
                  active
                    ? "border-transparent bg-brand-500/15 text-brand-700 dark:text-brand-300"
                    : "muted hover:bg-black/5 dark:hover:bg-white/5"
                )}
                style={active ? undefined : { borderColor: "var(--border)" }}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Dropdown filters */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select
            className="input"
            value={filters.account}
            onChange={(e) => navigate({ account: e.target.value, page: "1" })}
            aria-label="Filter by account"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={filters.category}
            onChange={(e) => navigate({ category: e.target.value, page: "1" })}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            <CategoryOptionGroups groups={groupsAll} />
          </select>

          <label className="relative">
            <Calendar
              size={15}
              className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              type="date"
              className="input pl-9"
              value={filters.start}
              max={filters.end || undefined}
              onChange={(e) => navigate({ start: e.target.value, page: "1" })}
              aria-label="From date"
            />
          </label>
          <label className="relative">
            <Calendar
              size={15}
              className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              type="date"
              className="input pl-9"
              value={filters.end}
              min={filters.start || undefined}
              onChange={(e) => navigate({ end: e.target.value, page: "1" })}
              aria-label="To date"
            />
          </label>
        </div>

        {/* Active filters summary */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="muted text-xs">Filters:</span>
            {filters.q && (
              <FilterPill label={`“${filters.q}”`} onRemove={() => navigate({ q: "", page: "1" })} />
            )}
            {filters.account && (
              <FilterPill
                label={accountById.get(filters.account)?.name ?? "Account"}
                onRemove={() => navigate({ account: "", page: "1" })}
              />
            )}
            {filters.category && (
              <FilterPill
                label={categoryById.get(filters.category)?.name ?? "Category"}
                onRemove={() => navigate({ category: "", page: "1" })}
              />
            )}
            {filters.filter && filters.filter !== "all" && (
              <FilterPill
                label={
                  chips.find((c) => c.value === filters.filter)?.label ?? filters.filter
                }
                onRemove={() => navigate({ filter: "all", page: "1" })}
              />
            )}
            {filters.start && (
              <FilterPill
                label={`From ${filters.start}`}
                onRemove={() => navigate({ start: "", page: "1" })}
              />
            )}
            {filters.end && (
              <FilterPill
                label={`To ${filters.end}`}
                onRemove={() => navigate({ end: "", page: "1" })}
              />
            )}
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- Register */}
      {rows.length === 0 ? (
        <EmptyState
          title={hasActiveFilters ? "No matching transactions" : "No transactions yet"}
          hint={
            hasActiveFilters
              ? "Try loosening your search or filters to see more activity."
              : "Connect a bank feed, import a statement, or add one by hand to get started."
          }
          action={
            hasActiveFilters ? (
              <button type="button" className="btn-ghost mt-1" onClick={clearAllFilters}>
                Clear filters
              </button>
            ) : (
              <button type="button" className="btn-primary mt-1" onClick={() => setAddOpen(true)}>
                <Plus size={16} />
                Add transaction
              </button>
            )
          }
        />
      ) : (
        <div
          className={clsx(
            "card overflow-hidden p-0 transition-opacity",
            isPending && "opacity-60"
          )}
        >
          {/* Desktop / tablet table */}
          <div className="no-scrollbar hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="muted border-b text-left text-xs uppercase tracking-wide"
                  style={{ borderColor: "var(--border)" }}
                >
                  <th className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-500"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked;
                      }}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Details</th>
                  <th className="px-3 py-2.5 font-medium">Account</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 text-center font-medium">Done</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const isSel = selected.has(t.id);
                  return (
                    <tr
                      key={t.id}
                      className={clsx(
                        "border-b transition last:border-0",
                        isSel
                          ? "bg-brand-500/[0.06]"
                          : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                      )}
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-3 py-3 align-middle">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-500"
                          checked={isSel}
                          onChange={() => toggleOne(t.id)}
                          aria-label="Select transaction"
                        />
                      </td>
                      <td className="muted whitespace-nowrap px-3 py-3 align-middle tabular-nums">
                        {format(parseISO(t.postedAt), "MMM d, yyyy")}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {t.payee || t.description || "—"}
                          </span>
                          {t.pending && (
                            <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">
                              Pending
                            </span>
                          )}
                        </div>
                        {t.description && t.description !== t.payee && (
                          <div className="muted mt-0.5 max-w-[26ch] truncate text-xs">
                            {t.description}
                          </div>
                        )}
                      </td>
                      <td className="muted whitespace-nowrap px-3 py-3 align-middle">
                        {t.accountName}
                      </td>
                      <td className="px-3 py-3 align-middle">{renderCategoryControl(t, false)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right align-middle">
                        <Money cents={t.amountCents} />
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex justify-center">{renderReviewToggle(t)}</div>
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex justify-end">{renderMoreButton(t)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
            {rows.map((t) => {
              const isSel = selected.has(t.id);
              return (
                <li
                  key={t.id}
                  className={clsx("flex flex-col gap-2 p-3", isSel && "bg-brand-500/[0.06]")}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-brand-500"
                      checked={isSel}
                      onChange={() => toggleOne(t.id)}
                      aria-label="Select transaction"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium leading-tight">
                          {t.payee || t.description || "—"}
                        </span>
                        <Money cents={t.amountCents} className="shrink-0" />
                      </div>
                      <div className="muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="tabular-nums">
                          {format(parseISO(t.postedAt), "MMM d, yyyy")}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="truncate">{t.accountName}</span>
                        {t.pending && (
                          <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-[26px]">
                    <div className="min-w-0 flex-1">{renderCategoryControl(t, true)}</div>
                    {renderReviewToggle(t)}
                    {renderMoreButton(t)}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ---------------------------------------------------------------- Pagination */}
      {(totalPages > 1 || total > 0) && (
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="muted text-xs tabular-nums">
            {total > 0 ? (
              <>
                Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of{" "}
                {total.toLocaleString()}
              </>
            ) : (
              "No results"
            )}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => navigate({ page: String(page - 1) })}
                className="btn-ghost px-3 py-1.5 text-sm"
              >
                <ChevronLeft size={15} />
                Prev
              </button>
              <span className="muted px-1 text-xs tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => navigate({ page: String(page + 1) })}
                className="btn-ghost px-3 py-1.5 text-sm"
              >
                Next
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- Bulk bar */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-3 md:bottom-6">
          <div className="card pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl p-2 pl-3 shadow-lg">
            <span className="text-sm font-semibold tabular-nums">
              {selected.size} selected
            </span>
            <span className="mx-0.5 hidden h-5 w-px bg-black/10 dark:bg-white/10 sm:block" />
            <select
              className="input h-9 w-auto py-1.5 text-sm"
              value=""
              disabled={bulkBusy}
              onChange={(e) => {
                if (e.target.value) bulk("setCategory", e.target.value);
                e.target.value = "";
              }}
              aria-label="Categorize selected"
            >
              <option value="">Categorize as…</option>
              <CategoryOptionGroups groups={groupsForAssign} />
            </select>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulk("markReviewed")}
              className="btn-ghost px-3 py-1.5 text-sm"
            >
              <CheckCheck size={15} />
              Reviewed
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulk("markTransfer")}
              className="btn-ghost px-3 py-1.5 text-sm"
            >
              <Repeat size={15} />
              Transfer
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulk("unreview")}
              className="btn-ghost hidden px-3 py-1.5 text-sm sm:inline-flex"
            >
              Unreview
            </button>
            {bulkBusy && <Loader2 size={16} className="muted animate-spin" />}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="muted grid h-8 w-8 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- Toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
          <div
            className={clsx(
              "pointer-events-auto rounded-xl px-4 py-2 text-sm font-medium text-white shadow-lg",
              toast.tone === "ok" ? "bg-brand-600" : "bg-rose-600"
            )}
          >
            {toast.msg}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- Modals */}
      {addOpen && (
        <AddTxnModal
          accounts={accounts}
          groups={groupsForAssign}
          defaultAccountId={filters.account || accounts[0]?.id || ""}
          onClose={() => setAddOpen(false)}
          onSubmit={submitCreate}
        />
      )}
      {splitFor && (
        <SplitModal
          key={splitFor.id}
          txn={splitFor}
          groups={groupsForAssign}
          onClose={() => setSplitFor(null)}
          onSubmit={(splits) => submitSplits(splitFor.id, splits)}
        />
      )}
      {detailsFor && (
        <DetailsModal
          key={detailsFor.id}
          txn={detailsFor}
          onClose={() => setDetailsFor(null)}
          onSubmit={(data) => submitDetails(detailsFor.id, data)}
        />
      )}
      {actionsFor && (
        <ActionsSheet
          txn={actionsFor}
          isTransfer={isTransfer(actionsFor)}
          onClose={() => setActionsFor(null)}
          onSplit={() => {
            const t = actionsFor;
            setActionsFor(null);
            setSplitFor(t);
          }}
          onDetails={() => {
            const t = actionsFor;
            setActionsFor(null);
            setDetailsFor(t);
          }}
          onTransfer={() => {
            const t = actionsFor;
            setActionsFor(null);
            void markTransfer(t);
          }}
          onUnlink={() => {
            const t = actionsFor;
            setActionsFor(null);
            void unlinkTransfer(t);
          }}
          onDelete={() => {
            const t = actionsFor;
            if (
              window.confirm(
                `Delete this ${formatMoney(t.amountCents)} transaction? This can't be undone.`
              )
            ) {
              setActionsFor(null);
              void deleteTxn(t);
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chip bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300">
      <span className="max-w-[16ch] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X size={12} />
      </button>
    </span>
  );
}

function ModalShell({
  title,
  subtitle,
  icon: Icon,
  onClose,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onClose}
    >
      <div
        className={clsx(
          "card max-h-[92dvh] w-full overflow-y-auto rounded-b-none rounded-t-3xl p-5 sm:rounded-3xl",
          wide ? "max-w-2xl" : "max-w-md"
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
              <Icon size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {subtitle && <p className="muted text-xs">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="muted grid h-9 w-9 shrink-0 place-items-center rounded-xl transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// --- Add transaction --------------------------------------------------------

function AddTxnModal({
  accounts,
  groups,
  defaultAccountId,
  onClose,
  onSubmit,
}: {
  accounts: AccountOption[];
  groups: CatGroup[];
  defaultAccountId: string;
  onClose: () => void;
  onSubmit: (payload: unknown) => Promise<string | null>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [date, setDate] = useState(today);
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!accountId) return setError("Pick an account.");
    if (!payee.trim()) return setError("Add a payee or description.");
    const magnitude = Math.abs(toCents(amount));
    if (magnitude === 0) return setError("Enter an amount.");
    const signedDollars = `${direction === "out" ? "-" : ""}${magnitude / 100}`;

    setSaving(true);
    const err = await onSubmit({
      accountId,
      postedAt: date,
      amount: signedDollars,
      payee: payee.trim(),
      description: description.trim(),
      categoryId: categoryId || undefined,
    });
    setSaving(false);
    if (err) return setError(err);
    onClose();
  }

  return (
    <ModalShell
      title="Add a transaction"
      subtitle="Record activity by hand"
      icon={Plus}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Account</span>
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="" disabled>
              Choose an account…
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.institution}
              </option>
            ))}
          </select>
        </label>

        {/* Direction toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection("out")}
            className={clsx(
              "flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition",
              direction === "out"
                ? "border-rose-400/60 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                : "muted"
            )}
            style={direction === "out" ? undefined : { borderColor: "var(--border)" }}
          >
            <ArrowUpRight size={16} />
            Money out
          </button>
          <button
            type="button"
            onClick={() => setDirection("in")}
            className={clsx(
              "flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition",
              direction === "in"
                ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "muted"
            )}
            style={direction === "in" ? undefined : { borderColor: "var(--border)" }}
          >
            <ArrowDownLeft size={16} />
            Money in
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Amount</span>
            <div className="relative">
              <span className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
                $
              </span>
              <input
                className="input pl-6"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Date</span>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Payee</span>
          <input
            className="input"
            placeholder="e.g. Staples"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Description <span className="muted font-normal">(optional)</span>
          </span>
          <input
            className="input"
            placeholder="Notes about this transaction"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Category <span className="muted font-normal">(optional)</span>
          </span>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorized</option>
            <CategoryOptionGroups groups={groups} />
          </select>
        </label>

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : "Add transaction"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// --- Split editor -----------------------------------------------------------

interface Draft {
  key: string;
  categoryId: string;
  amount: string;
  memo: string;
}

let draftSeq = 0;
function newDraft(categoryId = "", amount = "", memo = ""): Draft {
  draftSeq += 1;
  return { key: `d${draftSeq}`, categoryId, amount, memo };
}

function SplitModal({
  txn,
  groups,
  onClose,
  onSubmit,
}: {
  txn: TxnRow;
  groups: CatGroup[];
  onClose: () => void;
  onSubmit: (splits: unknown) => Promise<string | null>;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    txn.splits.length > 0
      ? txn.splits.map((s) => newDraft(s.categoryId ?? "", centsToInput(s.amountCents), s.memo))
      : [newDraft("", centsToInput(txn.amountCents))]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const target = txn.amountCents;
  const sumCents = drafts.reduce((n, d) => n + toCents(d.amount), 0);
  const remaining = target - sumCents;
  const balanced = remaining === 0;

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }
  function addRow() {
    setDrafts((prev) => [...prev, newDraft("", centsToInput(remaining !== 0 ? remaining : 0))]);
  }
  function removeRow(key: string) {
    setDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((d) => d.key !== key)));
  }
  function splitEvenly() {
    const n = drafts.length;
    if (n === 0) return;
    const base = Math.trunc(target / n);
    const rem = target - base * n;
    setDrafts((prev) =>
      prev.map((d, i) => ({ ...d, amount: centsToInput(base + (i === 0 ? rem : 0)) }))
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!balanced) {
      return setError(
        `Splits must add up to ${formatMoney(target)} — off by ${formatMoney(Math.abs(remaining))}.`
      );
    }
    setSaving(true);
    const err = await onSubmit(
      drafts.map((d) => ({
        categoryId: d.categoryId || null,
        amountCents: toCents(d.amount),
        memo: d.memo,
      }))
    );
    setSaving(false);
    if (err) return setError(err);
    onClose();
  }

  return (
    <ModalShell
      title="Split transaction"
      subtitle={`${txn.payee || txn.description || "Transaction"} · ${formatMoney(target)}`}
      icon={SplitIcon}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {drafts.map((d, i) => (
            <div key={d.key} className="rounded-xl border p-2.5" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <select
                  className="input h-9 min-w-0 flex-1 py-1.5 text-sm"
                  value={d.categoryId}
                  onChange={(e) => update(d.key, { categoryId: e.target.value })}
                  aria-label={`Split ${i + 1} category`}
                >
                  <option value="">Uncategorized</option>
                  <CategoryOptionGroups groups={groups} />
                </select>
                <div className="relative w-28 shrink-0">
                  <span className="muted pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm">
                    $
                  </span>
                  <input
                    className="input h-9 py-1.5 pl-5 text-right text-sm tabular-nums"
                    inputMode="decimal"
                    value={d.amount}
                    onChange={(e) => update(d.key, { amount: e.target.value })}
                    aria-label={`Split ${i + 1} amount`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(d.key)}
                  disabled={drafts.length <= 1}
                  aria-label="Remove split"
                  className="muted grid h-9 w-9 shrink-0 place-items-center rounded-lg transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <input
                className="input mt-2 h-8 py-1 text-xs"
                placeholder="Memo (optional)"
                value={d.memo}
                onChange={(e) => update(d.key, { memo: e.target.value })}
                aria-label={`Split ${i + 1} memo`}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={addRow}>
            <Plus size={15} />
            Add split
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={splitEvenly}>
            <Wand2 size={15} />
            Split evenly
          </button>
          <div className="ml-auto text-right text-sm">
            <div className="tabular-nums">
              <span className="muted">Allocated </span>
              <span className="font-medium">{formatMoney(sumCents)}</span>
              <span className="muted"> / {formatMoney(target)}</span>
            </div>
            <div
              className={clsx(
                "text-xs font-medium tabular-nums",
                balanced
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              )}
            >
              {balanced ? "Balanced ✓" : `${formatMoney(remaining, { signed: true })} left`}
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !balanced}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : "Save splits"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// --- Details editor ---------------------------------------------------------

function DetailsModal({
  txn,
  onClose,
  onSubmit,
}: {
  txn: TxnRow;
  onClose: () => void;
  onSubmit: (data: { payee: string; description: string; notes: string }) => Promise<string | null>;
}) {
  const [payee, setPayee] = useState(txn.payee);
  const [description, setDescription] = useState(txn.description);
  const [notes, setNotes] = useState(txn.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const err = await onSubmit({ payee: payee.trim(), description: description.trim(), notes });
    setSaving(false);
    if (err) return setError(err);
    onClose();
  }

  return (
    <ModalShell
      title="Edit details"
      subtitle={`${formatMoney(txn.amountCents)} · ${txn.accountName}`}
      icon={Pencil}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Payee</span>
          <input className="input" value={payee} onChange={(e) => setPayee(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Description</span>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Notes</span>
          <textarea
            className="input min-h-[80px] resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering about this transaction"
          />
        </label>

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : "Save details"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// --- Row actions sheet ------------------------------------------------------

function ActionsSheet({
  txn,
  isTransfer,
  onClose,
  onSplit,
  onDetails,
  onTransfer,
  onUnlink,
  onDelete,
}: {
  txn: TxnRow;
  isTransfer: boolean;
  onClose: () => void;
  onSplit: () => void;
  onDetails: () => void;
  onTransfer: () => void;
  onUnlink: () => void;
  onDelete: () => void;
}) {
  const rowClass =
    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5";
  return (
    <ModalShell
      title="Transaction actions"
      subtitle={`${txn.payee || txn.description || "Transaction"} · ${formatMoney(txn.amountCents)}`}
      icon={MoreHorizontal}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1">
        <button type="button" className={rowClass} onClick={onSplit}>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
            <SplitIcon size={16} />
          </span>
          Split into multiple categories
        </button>
        {isTransfer ? (
          <button type="button" className={rowClass} onClick={onUnlink}>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Repeat size={16} />
            </span>
            Unlink transfer
          </button>
        ) : (
          <button type="button" className={rowClass} onClick={onTransfer}>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
              <Repeat size={16} />
            </span>
            Mark as internal transfer
          </button>
        )}
        <button type="button" className={rowClass} onClick={onDetails}>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300">
            <Pencil size={16} />
          </span>
          Edit payee &amp; notes
        </button>
        <button
          type="button"
          className={clsx(rowClass, "text-rose-600 dark:text-rose-400")}
          onClick={onDelete}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <Trash2 size={16} />
          </span>
          Delete transaction
        </button>
      </div>
    </ModalShell>
  );
}
