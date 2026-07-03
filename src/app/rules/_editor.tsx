"use client";

// The interactive rules surface. Everything the user does here — adding, editing,
// toggling, reordering and deleting rules, plus the one-click "Re-apply" sweep —
// runs against the /api/rules endpoints. After each successful mutation we
// router.refresh() so the server data re-renders; optimistic local state keeps it
// feeling instant. The add/edit form lives in <RuleEditor> and live-previews the
// plain-English sentence as you type.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Repeat,
  Wand2,
} from "lucide-react";
import {
  MATCH_FIELDS,
  SECTION_LABELS,
  TRANSFER_CATEGORY,
  type Operator,
  type Section,
} from "@/lib/types";
import { formatMoney, toCents } from "@/lib/money";
import { Badge, EmptyState } from "@/components/ui";

// ---------------------------------------------------------------------------
// Shared shapes (also consumed by page.tsx)
// ---------------------------------------------------------------------------

export interface RuleRow {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  matchField: string; // MatchField
  operator: string; // Operator
  value: string;
  categoryId: string;
  categoryName: string;
  categorySection: string;
  markTransfer: boolean;
}

export interface RuleCategoryOption {
  id: string;
  name: string;
  section: string;
}

// ---------------------------------------------------------------------------
// Labels + sensible operator sets
// ---------------------------------------------------------------------------

const SECTION_ORDER: Section[] = [
  "expense",
  "income",
  "transfer",
  "asset",
  "liability",
  "equity",
];

const FIELD_LABELS: Record<string, string> = {
  payee: "Payee",
  description: "Description",
  amount: "Amount",
  account: "Account",
};

const OPERATOR_LABELS: Record<string, string> = {
  contains: "contains",
  equals: "equals",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches regex",
  gt: "is more than",
  lt: "is less than",
};

const STRING_OPS: Operator[] = ["contains", "equals", "starts_with", "ends_with", "regex"];
const AMOUNT_OPS: Operator[] = ["gt", "lt", "equals"];

function opsForField(field: string): Operator[] {
  return field === "amount" ? AMOUNT_OPS : STRING_OPS;
}

const ICON_BTN =
  "muted grid h-9 w-9 shrink-0 place-items-center rounded-xl transition hover:bg-black/5 dark:hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CatGroup {
  label: string;
  cats: RuleCategoryOption[];
}

function groupCategories(categories: RuleCategoryOption[]): CatGroup[] {
  return SECTION_ORDER.map((section) => ({
    label: SECTION_LABELS[section],
    cats: categories
      .filter((c) => c.section === section)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.cats.length > 0);
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

// ---------------------------------------------------------------------------
// The plain-English sentence (used in both the list and the live preview)
// ---------------------------------------------------------------------------

function RuleSentence({
  field,
  operator,
  value,
  categoryName,
  markTransfer,
}: {
  field: string;
  operator: string;
  value: string;
  categoryName: string;
  markTransfer: boolean;
}) {
  const target = markTransfer ? TRANSFER_CATEGORY : categoryName || "a category";
  return (
    <span className="leading-relaxed">
      <span className="muted">If </span>
      <span className="font-medium">{FIELD_LABELS[field] ?? field}</span>{" "}
      <span className="muted">{OPERATOR_LABELS[operator] ?? operator}</span>{" "}
      {field === "amount" ? (
        <span className="font-medium tabular-nums">
          {value.trim() ? formatMoney(toCents(value)) : "$0.00"}
        </span>
      ) : (
        <span className="font-medium">&ldquo;{value.trim() || "…"}&rdquo;</span>
      )}
      <span className="muted"> → </span>
      <span
        className={clsx(
          "chip align-middle",
          markTransfer
            ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
            : "bg-brand-500/15 text-brand-700 dark:text-brand-300"
        )}
      >
        {markTransfer && <Repeat size={11} />}
        {target}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Little toggle switch
// ---------------------------------------------------------------------------

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50",
        checked ? "bg-brand-500" : "bg-black/15 dark:bg-white/20"
      )}
    >
      <span
        className={clsx(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Add / edit rule dialog (self-triggering, like the account form)
// ---------------------------------------------------------------------------

function RuleEditor({
  mode,
  rule,
  categories,
  defaultPriority,
  trigger,
}: {
  mode: "create" | "edit";
  rule?: RuleRow;
  categories: RuleCategoryOption[];
  defaultPriority: number;
  trigger: (open: () => void) => ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const groups = useMemo(() => groupCategories(categories), [categories]);
  const transferCatId = useMemo(
    () => categories.find((c) => c.name === TRANSFER_CATEGORY)?.id ?? "",
    [categories]
  );

  const [name, setName] = useState(rule?.name ?? "");
  const [field, setField] = useState<string>(rule?.matchField ?? "payee");
  const [operator, setOperator] = useState<string>(rule?.operator ?? "contains");
  const [value, setValue] = useState(rule?.value ?? "");
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? defaultPriority));
  const [markTransfer, setMarkTransfer] = useState(rule?.markTransfer ?? false);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  function resetForm() {
    setName(rule?.name ?? "");
    setField(rule?.matchField ?? "payee");
    setOperator(rule?.operator ?? "contains");
    setValue(rule?.value ?? "");
    setCategoryId(rule?.categoryId ?? "");
    setPriority(String(rule?.priority ?? defaultPriority));
    setMarkTransfer(rule?.markTransfer ?? false);
    setEnabled(rule?.enabled ?? true);
    setError("");
  }

  function openDialog() {
    resetForm();
    setOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setOpen(false);
  }

  // Escape to close + lock background scroll while the dialog is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, saving]);

  // Keep the operator valid whenever the field changes shape (text <-> amount).
  function onFieldChange(next: string) {
    setField(next);
    const allowed = opsForField(next);
    if (!allowed.includes(operator as Operator)) setOperator(allowed[0]);
  }

  // Flagging a rule as a transfer still needs a fallback category; default it to
  // the Transfer category when one isn't chosen yet.
  function onToggleTransfer(next: boolean) {
    setMarkTransfer(next);
    if (next && !categoryId && transferCatId) setCategoryId(transferCatId);
  }

  const previewCategoryName = useMemo(
    () => categories.find((c) => c.id === categoryId)?.name ?? "",
    [categories, categoryId]
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Give your rule a name.");
    if (!value.trim()) {
      return setError(field === "amount" ? "Enter an amount to match." : "Enter some text to match.");
    }
    if (field === "amount" && isNaN(parseFloat(value.replace(/[$,\s]/g, "")))) {
      return setError("Enter a dollar amount, like 50 or 12.99.");
    }
    if (operator === "regex") {
      try {
        new RegExp(value);
      } catch {
        return setError("That regular expression isn't valid.");
      }
    }
    if (!categoryId) return setError("Pick a category to assign.");

    const priorityNum = parseInt(priority, 10);
    setSaving(true);
    const payload = {
      name: name.trim(),
      matchField: field,
      operator,
      value: value.trim(),
      categoryId,
      priority: Number.isFinite(priorityNum) ? priorityNum : defaultPriority,
      markTransfer,
      enabled,
    };
    const url = mode === "edit" && rule ? `/api/rules/${rule.id}` : "/api/rules";
    const method = mode === "edit" ? "PATCH" : "POST";
    const res = await api(url, method, payload);
    setSaving(false);

    if (!res || !res.ok) {
      setError(await readError(res));
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      {trigger(openDialog)}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={mode === "edit" ? "Edit rule" : "Add a rule"}
          onMouseDown={closeDialog}
        >
          <div
            className="card max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none rounded-t-3xl p-5 sm:rounded-3xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
                  <Wand2 size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold">
                    {mode === "edit" ? "Edit rule" : "New rule"}
                  </h2>
                  <p className="muted text-xs">
                    {mode === "edit"
                      ? "Fine-tune when this rule fires."
                      : "Automatically categorize matching transactions."}
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
                <span className="text-sm font-medium">Rule name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Coffee shops"
                  autoFocus
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">When</span>
                  <select
                    className="input"
                    value={field}
                    onChange={(e) => onFieldChange(e.target.value)}
                  >
                    {MATCH_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f] ?? f}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Condition</span>
                  <select
                    className="input"
                    value={operator}
                    onChange={(e) => setOperator(e.target.value)}
                  >
                    {opsForField(field).map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op] ?? op}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Value</span>
                {field === "amount" ? (
                  <div className="relative">
                    <span className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
                      $
                    </span>
                    <input
                      className="input pl-6"
                      inputMode="decimal"
                      placeholder="50.00"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </div>
                ) : (
                  <input
                    className="input"
                    placeholder={operator === "regex" ? "e.g. ^(AMZN|Amazon)" : "e.g. Uber"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
                <span className="muted text-xs">
                  {field === "amount"
                    ? "Compared with the transaction amount, ignoring whether it's money in or out."
                    : operator === "regex"
                    ? "A JavaScript regular expression (case-insensitive)."
                    : "Matching ignores capitalization."}
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Categorize as</span>
                <select
                  className="input"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="" disabled>
                    Choose a category…
                  </option>
                  {groups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.cats.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {markTransfer && (
                  <span className="muted text-xs">
                    Matches are flagged as internal transfers; this stays as the fallback category.
                  </span>
                )}
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Priority</span>
                <input
                  type="number"
                  className="input"
                  value={priority}
                  min={0}
                  step={10}
                  onChange={(e) => setPriority(e.target.value)}
                />
                <span className="muted text-xs">Lower numbers run first.</span>
              </label>

              <div
                className="flex items-center justify-between gap-3 rounded-xl border p-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div>
                  <div className="text-sm font-medium">Mark as transfer</div>
                  <div className="muted text-xs">
                    Treat matches as money moved between your own accounts.
                  </div>
                </div>
                <Switch checked={markTransfer} onChange={onToggleTransfer} label="Mark as transfer" />
              </div>

              <div
                className="flex items-center justify-between gap-3 rounded-xl border p-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div>
                  <div className="text-sm font-medium">Enabled</div>
                  <div className="muted text-xs">Only enabled rules run on import and re-apply.</div>
                </div>
                <Switch checked={enabled} onChange={setEnabled} label="Enabled" />
              </div>

              {/* Live preview of the sentence */}
              <div
                className="rounded-xl border border-dashed p-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="muted mb-1 text-xs font-medium uppercase tracking-wide">Preview</div>
                <div className="text-sm">
                  <RuleSentence
                    field={field}
                    operator={operator}
                    value={value}
                    categoryName={previewCategoryName}
                    markTransfer={markTransfer}
                  />
                </div>
              </div>

              {error && <p className="text-sm text-rose-500">{error}</p>}

              <div className="mt-1 flex items-center justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={closeDialog} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : mode === "edit" ? (
                    "Save changes"
                  ) : (
                    "Add rule"
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

// ---------------------------------------------------------------------------
// A single rule row
// ---------------------------------------------------------------------------

function RuleRowCard({
  rule,
  index,
  total,
  categories,
  defaultPriority,
  busy,
  onToggle,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  rule: RuleRow;
  index: number;
  total: number;
  categories: RuleCategoryOption[];
  defaultPriority: number;
  busy: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={clsx(
        "card flex flex-col gap-3 p-3 transition sm:flex-row sm:items-center sm:p-4",
        !rule.enabled && "opacity-70"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {/* Reorder control */}
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0 || busy}
            aria-label="Move up"
            className="muted grid h-6 w-7 place-items-center rounded-md transition hover:bg-black/5 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/5"
          >
            <ArrowUp size={14} />
          </button>
          <span className="grid h-6 min-w-[24px] place-items-center rounded-md bg-brand-500/10 px-1 text-xs font-semibold tabular-nums text-brand-700 dark:text-brand-300">
            {index + 1}
          </span>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1 || busy}
            aria-label="Move down"
            className="muted grid h-6 w-7 place-items-center rounded-md transition hover:bg-black/5 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/5"
          >
            <ArrowDown size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{rule.name || "Untitled rule"}</span>
            {rule.markTransfer && (
              <Badge tone="blue">
                <Repeat size={11} />
                Transfer
              </Badge>
            )}
            {!rule.enabled && <Badge tone="neutral">Off</Badge>}
          </div>
          <div className="muted mt-1 text-sm">
            <RuleSentence
              field={rule.matchField}
              operator={rule.operator}
              value={rule.value}
              categoryName={rule.categoryName}
              markTransfer={rule.markTransfer}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1.5 sm:ml-auto sm:shrink-0">
        {busy && <Loader2 size={14} className="muted mr-0.5 animate-spin" />}
        <Switch
          checked={rule.enabled}
          onChange={onToggle}
          disabled={busy}
          label={rule.enabled ? "Disable rule" : "Enable rule"}
        />
        <RuleEditor
          mode="edit"
          rule={rule}
          categories={categories}
          defaultPriority={defaultPriority}
          trigger={(open) => (
            <button type="button" onClick={open} aria-label="Edit rule" className={ICON_BTN}>
              <Pencil size={16} />
            </button>
          )}
        />
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete rule"
          className={clsx(ICON_BTN, "hover:text-rose-600 dark:hover:text-rose-400")}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The manager: toolbar (add + re-apply) and the ordered list
// ---------------------------------------------------------------------------

export function RulesManager({
  rules,
  categories,
}: {
  rules: RuleRow[];
  categories: RuleCategoryOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local mirror of the server rows for optimistic updates.
  const [rows, setRows] = useState<RuleRow[]>(rules);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [reapplying, setReapplying] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setRows(rules), [rules]);
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const defaultPriority = useMemo(
    () => (rows.length ? Math.max(...rows.map((r) => r.priority)) + 10 : 100),
    [rows]
  );
  const enabledCount = rows.filter((r) => r.enabled).length;

  function flash(msg: string, tone: "ok" | "err") {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  function markBusy(ids: string[], on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  async function reapply() {
    setReapplying(true);
    const res = await api("/api/rules/reapply", "POST");
    setReapplying(false);
    if (!res || !res.ok) {
      flash(await readError(res), "err");
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { updated?: number };
    const n = j.updated ?? 0;
    flash(`${n} transaction${n === 1 ? "" : "s"} updated`, "ok");
    refresh();
  }

  async function toggleEnabled(rule: RuleRow) {
    const next = !rule.enabled;
    markBusy([rule.id], true);
    setRows((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)));
    const res = await api(`/api/rules/${rule.id}`, "PATCH", { enabled: next });
    markBusy([rule.id], false);
    if (!res || !res.ok) {
      setRows(rules);
      flash(await readError(res), "err");
      return;
    }
    flash(next ? "Rule enabled" : "Rule paused", "ok");
    refresh();
  }

  async function move(rule: RuleRow, dir: "up" | "down") {
    const idx = rows.findIndex((r) => r.id === rule.id);
    if (idx < 0) return;
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return;

    const a = rows[idx];
    const b = rows[swapIdx];
    // When two rules share a priority, nudging one is enough to break the tie in
    // the desired direction; otherwise swap their priorities outright.
    const patches =
      a.priority === b.priority
        ? [{ id: a.id, priority: dir === "up" ? b.priority - 1 : b.priority + 1 }]
        : [
            { id: a.id, priority: b.priority },
            { id: b.id, priority: a.priority },
          ];
    const ids = patches.map((p) => p.id);

    const prev = rows;
    const optimistic = rows
      .map((r) => {
        const p = patches.find((x) => x.id === r.id);
        return p ? { ...r, priority: p.priority } : r;
      })
      .slice()
      .sort((x, y) => x.priority - y.priority);

    markBusy(ids, true);
    setRows(optimistic);

    for (const p of patches) {
      const res = await api(`/api/rules/${p.id}`, "PATCH", { priority: p.priority });
      if (!res || !res.ok) {
        markBusy(ids, false);
        setRows(prev);
        flash(await readError(res), "err");
        return;
      }
    }
    markBusy(ids, false);
    refresh();
  }

  async function remove(rule: RuleRow) {
    if (
      !window.confirm(`Delete the rule “${rule.name || "Untitled rule"}”? This can't be undone.`)
    ) {
      return;
    }
    markBusy([rule.id], true);
    setRows((prev) => prev.filter((r) => r.id !== rule.id));
    const res = await api(`/api/rules/${rule.id}`, "DELETE");
    markBusy([rule.id], false);
    if (!res || !res.ok) {
      setRows(rules);
      flash(await readError(res), "err");
      return;
    }
    flash("Rule deleted", "ok");
    refresh();
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="muted text-sm">
          {rows.length === 0 ? (
            "No rules yet"
          ) : (
            <>
              {rows.length} {rows.length === 1 ? "rule" : "rules"} · {enabledCount} active
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reapply}
            disabled={reapplying}
            className="btn-ghost"
          >
            {reapplying ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            Re-apply rules now
          </button>
          <RuleEditor
            mode="create"
            categories={categories}
            defaultPriority={defaultPriority}
            trigger={(open) => (
              <button type="button" onClick={open} className="btn-primary">
                <Plus size={16} />
                Add rule
              </button>
            )}
          />
        </div>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <EmptyState
          title="No rules yet"
          hint="Create a rule to have new transactions categorized automatically as they come in. For example: if the payee contains “Uber”, categorize it as Transportation."
          action={
            <RuleEditor
              mode="create"
              categories={categories}
              defaultPriority={defaultPriority}
              trigger={(open) => (
                <button type="button" onClick={open} className="btn-primary mt-1">
                  <Plus size={16} />
                  Create your first rule
                </button>
              )}
            />
          }
        />
      ) : (
        <div className={clsx("flex flex-col gap-3 transition-opacity", isPending && "opacity-60")}>
          {rows.map((rule, i) => (
            <RuleRowCard
              key={rule.id}
              rule={rule}
              index={i}
              total={rows.length}
              categories={categories}
              defaultPriority={defaultPriority}
              busy={busyIds.has(rule.id)}
              onToggle={() => toggleEnabled(rule)}
              onMoveUp={() => move(rule, "up")}
              onMoveDown={() => move(rule, "down")}
              onDelete={() => remove(rule)}
            />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-3 md:bottom-6">
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
    </div>
  );
}
