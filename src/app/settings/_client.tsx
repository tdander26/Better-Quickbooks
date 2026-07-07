"use client";

// Interactive Settings surfaces:
//   • BankFeedCard        — connect a SimpleFIN token + the marquee "Refresh now"
//   • CsvImportCard       — pick an account, paste/upload a CSV, import
//   • ChartOfAccountsCard — inline add / rename / delete categories by section
// Every mutation hits an API route then calls router.refresh() to re-render the
// server data behind these cards.
import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  KeyRound,
  ExternalLink,
  Link2,
  ArrowRight,
  Landmark,
  Upload,
  FileText,
  ClipboardPaste,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Lock,
  TrendingUp,
  TrendingDown,
  Wallet,
  Scale,
  ArrowLeftRight,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { SECTIONS, SECTION_LABELS, type Section } from "@/lib/types";
import { CategoryIcon } from "@/lib/icons";
import { taxLineGroupsForSection, sectionSupportsTaxLine } from "@/lib/tax-lines";

// ── Shared prop shapes (plain, server-serializable) ──────────────────────────
export interface ConnectionInfo {
  id: string;
  status: string;
  lastSyncedRel: string | null;
  lastSyncedAbs: string | null;
  lastError: string | null;
  linkedAccounts: number;
}
export interface AccountLite {
  id: string;
  name: string;
  institution: string;
  type: string;
}
export interface CategoryLite {
  id: string;
  name: string;
  section: string;
  icon: string;
  isSystem: boolean;
  taxLine: string;
}

interface SyncSummary {
  imported: number;
  skipped: number;
  accountsSeen?: number;
  errors: string[];
}

async function postJson(
  url: string,
  body?: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST"
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!res) return { ok: false, data: { error: "Network error. Please try again." } };
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

// ── Small building blocks ────────────────────────────────────────────────────
function CardShell({
  icon: Icon,
  title,
  subtitle,
  accent = "brand",
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  accent?: "brand" | "sky" | "violet";
  children: ReactNode;
}) {
  const accents: Record<string, string> = {
    brand: "from-brand-400 to-brand-600",
    sky: "from-sky-400 to-sky-600",
    violet: "from-violet-400 to-violet-600",
  };
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <div
          className={clsx(
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b text-white shadow-sm",
            accents[accent]
          )}
        >
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          {subtitle && <p className="muted mt-0.5 text-sm">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function ErrorList({ errors, title }: { errors: string[]; title?: string }) {
  if (!errors.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle size={14} />
        {title ?? `${errors.length} note${errors.length === 1 ? "" : "s"} from the provider`}
      </div>
      <ul className="muted list-disc space-y-0.5 pl-5">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

// ── 1) Bank feed (SimpleFIN) ─────────────────────────────────────────────────
export function BankFeedCard({ connection }: { connection: ConnectionInfo | null }) {
  return (
    <CardShell
      icon={Landmark}
      title="Bank feed"
      subtitle="Sync balances & transactions automatically with SimpleFIN"
    >
      {connection ? <ConnectedFeed connection={connection} /> : <ConnectForm />}
    </CardShell>
  );
}

function ConnectForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncSummary | null>(null);

  async function connect() {
    if (!token.trim()) {
      setError("Paste your setup token first.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    const { ok, data } = await postJson("/api/feeds/connect", { setupToken: token.trim() });
    setBusy(false);
    if (!ok) {
      setError((data.error as string) || "Couldn't connect. Double-check the token.");
      return;
    }
    setResult({
      imported: Number(data.imported ?? 0),
      skipped: Number(data.skipped ?? 0),
      accountsSeen: Number(data.accountsSeen ?? 0),
      errors: (data.errors as string[]) ?? [],
    });
    setToken("");
    router.refresh();
  }

  return (
    <div>
      <ol className="mb-4 space-y-2">
        {[
          <>
            Open{" "}
            <a
              href="https://bridge.simplefin.org"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              bridge.simplefin.org <ExternalLink size={12} />
            </a>{" "}
            and connect your bank.
          </>,
          <>Copy the one-time <span className="font-medium">setup token</span> it gives you.</>,
          <>Paste it below and hit Connect — we&apos;ll pull the last 90 days.</>,
        ].map((step, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/15 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
              {i + 1}
            </span>
            <span className="muted">{step}</span>
          </li>
        ))}
      </ol>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRound size={14} /> Setup token
        </span>
        <textarea
          className="input min-h-[84px] resize-y font-mono text-xs leading-relaxed"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste the base64 setup token here…"
          spellCheck={false}
        />
      </label>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-500">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      <button
        type="button"
        onClick={connect}
        disabled={busy || !token.trim()}
        className="btn-primary mt-3 w-full sm:w-auto"
      >
        {busy ? <Loader2 className="animate-spin" size={16} /> : <Link2 size={16} />}
        {busy ? "Connecting…" : "Connect bank feed"}
      </button>

      {result && (
        <div className="mt-4 rounded-2xl border border-brand-500/30 bg-brand-500/10 p-4">
          <div className="flex items-center gap-2 font-medium text-brand-700 dark:text-brand-300">
            <CheckCircle2 size={18} /> Connected!
          </div>
          <p className="muted mt-1 text-sm">
            Imported <span className="font-semibold text-[var(--text)]">{result.imported}</span>{" "}
            transaction{result.imported === 1 ? "" : "s"}
            {result.skipped > 0 && <> · skipped {result.skipped} already on file</>}
            {result.accountsSeen ? <> · {result.accountsSeen} account{result.accountsSeen === 1 ? "" : "s"}</> : null}.
          </p>
          <ErrorList errors={result.errors} />
        </div>
      )}
    </div>
  );
}

function ConnectedFeed({ connection }: { connection: ConnectionInfo }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const isError = connection.status === "error" || phase === "error";

  async function refresh() {
    setPhase("loading");
    setError("");
    if (timer.current) clearTimeout(timer.current);
    const { ok, data } = await postJson("/api/feeds/refresh");
    if (!ok) {
      setPhase("error");
      setError((data.error as string) || "Refresh failed. Please try again.");
      return;
    }
    setSummary({
      imported: Number(data.imported ?? 0),
      skipped: Number(data.skipped ?? 0),
      accountsSeen: Number(data.accountsSeen ?? 0),
      errors: (data.errors as string[]) ?? [],
    });
    setPhase("success");
    router.refresh();
    timer.current = setTimeout(() => setPhase("idle"), 4500);
  }

  const loading = phase === "loading";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={clsx(
            "chip",
            isError
              ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          )}
        >
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              isError ? "bg-rose-500" : "bg-emerald-500"
            )}
          />
          {isError ? "Needs attention" : "Connected"}
        </span>
        <div className="muted text-sm">
          <span className="font-medium text-[var(--text)]">{connection.linkedAccounts}</span> linked
          account{connection.linkedAccounts === 1 ? "" : "s"}
        </div>
        <div className="muted text-sm" title={connection.lastSyncedAbs ?? undefined}>
          {phase === "success"
            ? "Synced just now"
            : connection.lastSyncedRel
              ? `Last synced ${connection.lastSyncedRel}`
              : "Not synced yet"}
        </div>
      </div>

      <button
        type="button"
        onClick={refresh}
        disabled={loading}
        className={clsx(
          "btn mt-4 w-full justify-center gap-2 rounded-2xl px-5 py-3 text-base font-semibold text-white shadow-md transition sm:w-auto",
          phase === "success"
            ? "bg-gradient-to-b from-emerald-400 to-emerald-600"
            : "bg-gradient-to-b from-brand-400 to-brand-600 hover:-translate-y-0.5 hover:shadow-lg"
        )}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={20} /> Syncing your accounts…
          </>
        ) : phase === "success" ? (
          <>
            <CheckCircle2 size={20} /> All caught up
          </>
        ) : (
          <>
            <RefreshCw size={20} /> Refresh now
          </>
        )}
      </button>

      {phase === "success" && summary && (
        <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={18} /> Refresh complete
          </div>
          <p className="muted mt-1 text-sm">
            Imported <span className="font-semibold text-[var(--text)]">{summary.imported}</span> new
            {summary.imported === 1 ? " transaction" : " transactions"}, skipped{" "}
            <span className="font-semibold text-[var(--text)]">{summary.skipped}</span> already on file
            {summary.accountsSeen ? <> across {summary.accountsSeen} account{summary.accountsSeen === 1 ? "" : "s"}</> : null}.
          </p>
          <ErrorList errors={summary.errors} />
        </div>
      )}

      {isError && (error || connection.lastError) && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={14} /> Last sync hit a snag
          </div>
          <p className="mt-0.5 break-words">{error || connection.lastError}</p>
        </div>
      )}
    </div>
  );
}

// ── 2) CSV import ────────────────────────────────────────────────────────────
const CSV_EXAMPLE = `date,description,amount,payee
2026-06-01,Trader Joe's #204,-64.12,Trader Joe's
2026-06-02,Payroll deposit,2400.00,Acme Corp
2026-06-03,Spotify Premium,-11.99,Spotify`;

export function CsvImportCard({ accounts }: { accounts: AccountLite[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text().catch(() => "");
    setCsv(text);
    setFileName(file.name);
    setSummary(null);
    setError("");
  }

  async function importCsv() {
    if (!accountId) {
      setError("Pick an account to import into.");
      return;
    }
    if (!csv.trim()) {
      setError("Paste some CSV or choose a file first.");
      return;
    }
    setBusy(true);
    setError("");
    setSummary(null);
    const { ok, data } = await postJson("/api/import/csv", { accountId, csv });
    setBusy(false);
    if (!ok) {
      setError((data.error as string) || "Import failed. Check your columns and try again.");
      return;
    }
    setSummary({
      imported: Number(data.imported ?? 0),
      skipped: Number(data.skipped ?? 0),
      errors: (data.errors as string[]) ?? [],
    });
    setCsv("");
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  if (accounts.length === 0) {
    return (
      <CardShell icon={FileText} title="Import a CSV" accent="sky" subtitle="Bring in transactions from a spreadsheet or bank export">
        <p className="muted text-sm">
          Add a bank or credit-card account first, then come back to import its history.
        </p>
      </CardShell>
    );
  }

  return (
    <CardShell
      icon={FileText}
      title="Import a CSV"
      accent="sky"
      subtitle="Bring in transactions from a spreadsheet or bank export"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Import into</span>
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.institution} · {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Upload a file</span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="btn-ghost justify-start"
          >
            <Upload size={16} />
            <span className="truncate">{fileName || "Choose .csv file"}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={onFile}
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Or paste CSV</span>
          <button
            type="button"
            onClick={() => {
              setCsv(CSV_EXAMPLE);
              setFileName("");
            }}
            className="muted inline-flex items-center gap-1 text-xs hover:text-[var(--text)]"
          >
            <ClipboardPaste size={13} /> Use example
          </button>
        </div>
        <textarea
          className="input min-h-[120px] resize-y font-mono text-xs leading-relaxed"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            if (fileName) setFileName("");
          }}
          placeholder={CSV_EXAMPLE}
          spellCheck={false}
        />
        <p className="muted mt-1.5 text-xs">
          Columns: <code className="rounded bg-black/5 px-1 dark:bg-white/10">date</code>,{" "}
          <code className="rounded bg-black/5 px-1 dark:bg-white/10">description</code>,{" "}
          <code className="rounded bg-black/5 px-1 dark:bg-white/10">amount</code> (negative = money
          out), and optional <code className="rounded bg-black/5 px-1 dark:bg-white/10">payee</code>.
          The first row must be the header.
        </p>
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-500">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      <button
        type="button"
        onClick={importCsv}
        disabled={busy || !csv.trim()}
        className="btn-primary mt-3 w-full sm:w-auto"
      >
        {busy ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}
        {busy ? "Importing…" : "Import transactions"}
      </button>

      {summary && (
        <div className="mt-4 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4">
          <div className="flex items-center gap-2 font-medium text-sky-700 dark:text-sky-300">
            <CheckCircle2 size={18} /> Import complete
          </div>
          <p className="muted mt-1 text-sm">
            Added <span className="font-semibold text-[var(--text)]">{summary.imported}</span>{" "}
            transaction{summary.imported === 1 ? "" : "s"}
            {summary.skipped > 0 && <> · skipped {summary.skipped} (duplicate or unreadable)</>}.
          </p>
          <ErrorList errors={summary.errors} title="Some rows were skipped" />
        </div>
      )}
    </CardShell>
  );
}

// ── 3) Chart of accounts (categories) ────────────────────────────────────────
const SECTION_ICONS: Record<Section, LucideIcon> = {
  income: TrendingUp,
  expense: TrendingDown,
  asset: Wallet,
  liability: Landmark,
  equity: Scale,
  transfer: ArrowLeftRight,
};

export function ChartOfAccountsCard({ categories }: { categories: CategoryLite[] }) {
  const grouped = SECTIONS.map((section) => ({
    section,
    items: categories.filter((c) => c.section === section),
  })).filter((g) => g.items.length > 0 || g.section === "income" || g.section === "expense");

  return (
    <CardShell
      icon={Scale}
      title="Chart of accounts"
      accent="violet"
      subtitle="Organize spending & income into categories for your reports"
    >
      <div className="flex flex-col gap-5">
        {grouped.map((g) => (
          <SectionGroup key={g.section} section={g.section} items={g.items} />
        ))}
      </div>
    </CardShell>
  );
}

function SectionGroup({ section, items }: { section: Section; items: CategoryLite[] }) {
  const router = useRouter();
  const Icon = SECTION_ICONS[section];
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    const name = draft.trim();
    if (!name) return;
    setAdding(true);
    setError("");
    const { ok, data } = await postJson("/api/categories", { name, section });
    setAdding(false);
    if (!ok) {
      setError((data.error as string) || "Couldn't add that category.");
      return;
    }
    setDraft("");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 px-0.5">
        <Icon size={15} className="muted" />
        <h3 className="text-sm font-semibold">{SECTION_LABELS[section]}</h3>
        <span className="muted text-xs">
          {items.length} categor{items.length === 1 ? "y" : "ies"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Plus
              size={15}
              className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              className="input pl-8"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder={`Add a category to ${SECTION_LABELS[section]}…`}
            />
          </div>
          <button
            type="button"
            onClick={add}
            disabled={adding || !draft.trim()}
            className="btn-ghost shrink-0"
          >
            {adding ? <Loader2 className="animate-spin" size={16} /> : "Add"}
          </button>
        </div>
        {error && (
          <p className="flex items-center gap-1.5 text-xs text-rose-500">
            <AlertTriangle size={13} /> {error}
          </p>
        )}
      </div>
    </div>
  );
}

function CategoryRow({ category }: { category: CategoryLite }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === category.name) {
      setEditing(false);
      setName(category.name);
      return;
    }
    setBusy(true);
    setError("");
    const { ok, data } = await postJson(`/api/categories/${category.id}`, { name: trimmed }, "PATCH");
    setBusy(false);
    if (!ok) {
      setError((data.error as string) || "Couldn't rename.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Delete the "${category.name}" category? Transactions using it become uncategorized.`)) {
      return;
    }
    setBusy(true);
    setError("");
    const { ok, data } = await postJson(`/api/categories/${category.id}`, undefined, "DELETE");
    setBusy(false);
    if (!ok) {
      setError((data.error as string) || "Couldn't delete.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="group rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-gray-500 dark:text-gray-400">
        <CategoryIcon name={category.icon} size={15} />
      </span>

      {editing ? (
        <input
          autoFocus
          className="input h-8 flex-1 py-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              setEditing(false);
              setName(category.name);
              setError("");
            }
          }}
        />
      ) : (
        <span className="flex-1 truncate text-sm">{category.name}</span>
      )}

      {category.isSystem && !editing && (
        <span className="chip bg-black/5 text-gray-500 dark:bg-white/10 dark:text-gray-400">
          <Lock size={11} /> Built-in
        </span>
      )}

      {error && <span className="text-xs text-rose-500">{error}</span>}

      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              aria-label="Save"
              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
            >
              {busy ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(category.name);
                setError("");
              }}
              aria-label="Cancel"
              className="muted grid h-8 w-8 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X size={15} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={`Rename ${category.name}`}
              className="muted grid h-8 w-8 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy || category.isSystem}
              aria-label={`Delete ${category.name}`}
              title={category.isSystem ? "Built-in categories can't be deleted" : undefined}
              className={clsx(
                "grid h-8 w-8 place-items-center rounded-lg transition",
                category.isSystem
                  ? "muted cursor-not-allowed opacity-40"
                  : "text-rose-500 hover:bg-rose-500/10"
              )}
            >
              {busy ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
            </button>
          </>
        )}
      </div>
      </div>
      {sectionSupportsTaxLine(category.section) && (
        <TaxLinePicker
          categoryId={category.id}
          section={category.section}
          value={category.taxLine}
        />
      )}
    </div>
  );
}

// Per-category tax-line assignment. Offers both Schedule C and Form 1120-S line
// sets so the owner maps each category to whichever form matches their entity.
function TaxLinePicker({
  categoryId,
  section,
  value,
}: {
  categoryId: string;
  section: string;
  value: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const groups = taxLineGroupsForSection(section);

  // Preserve a legacy/custom value that isn't in the curated list.
  const known = new Set(groups.flatMap((g) => g.options.map((o) => o.value)));
  const hasCustom = value !== "" && !known.has(value);

  async function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setBusy(true);
    setError("");
    setSaved(false);
    const { ok, data } = await postJson(`/api/categories/${categoryId}`, { taxLine: next }, "PATCH");
    setBusy(false);
    if (!ok) {
      setError((data.error as string) || "Couldn't save tax line.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    router.refresh();
  }

  return (
    <div className="mt-1.5 flex items-center gap-2 pl-8">
      <Receipt size={12} className="muted shrink-0" aria-hidden />
      <select
        className="input h-8 flex-1 py-0 text-xs"
        value={value}
        onChange={onChange}
        disabled={busy}
        aria-label="Tax line"
      >
        <option value="">No tax line</option>
        {hasCustom && <option value={value}>{value} (current)</option>}
        {groups.map((g) => (
          <optgroup key={g.form} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {busy ? (
        <Loader2 className="muted shrink-0 animate-spin" size={13} />
      ) : saved ? (
        <Check className="shrink-0 text-emerald-500" size={13} />
      ) : null}
      {error && <span className="shrink-0 text-xs text-rose-500">{error}</span>}
    </div>
  );
}
