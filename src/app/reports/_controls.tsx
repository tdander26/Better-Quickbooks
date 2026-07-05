"use client";

// Reports toolbar: a segmented tab switcher (P&L / Balance Sheet / Cash Flow /
// By month), quick date-range presets, an account filter, an "as of" date picker
// (Balance Sheet only), and a CSV export button. Each control updates the URL
// (?tab&start&end&account&asOf) via router.push so the server component re-renders
// with fresh figures; a pending transition dims the toolbar while that happens.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
} from "date-fns";
import {
  TrendingUp,
  Scale,
  ArrowLeftRight,
  CalendarRange,
  Download,
  CalendarDays,
  Wallet,
  type LucideIcon,
} from "lucide-react";

type Tab = "pl" | "balance" | "cashflow" | "monthly";

interface AccountOption {
  id: string;
  name: string;
  institution: string;
}

// Kept in sync with page.tsx's sentinel for the "All time" range.
const ALL_TIME_START = "2000-01-01";

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: "pl", label: "Profit & Loss", icon: TrendingUp },
  { key: "balance", label: "Balance Sheet", icon: Scale },
  { key: "cashflow", label: "Cash Flow", icon: ArrowLeftRight },
  { key: "monthly", label: "By month", icon: CalendarRange },
];

function fmt(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function ReportControls({
  tab,
  start,
  end,
  account,
  asOf,
  accounts,
}: {
  tab: Tab;
  start: string;
  end: string;
  account: string;
  asOf: string;
  accounts: AccountOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const now = new Date();
  const presets = [
    { key: "month", label: "This month", start: fmt(startOfMonth(now)), end: fmt(endOfMonth(now)) },
    {
      key: "last",
      label: "Last month",
      start: fmt(startOfMonth(subMonths(now, 1))),
      end: fmt(endOfMonth(subMonths(now, 1))),
    },
    { key: "quarter", label: "This quarter", start: fmt(startOfQuarter(now)), end: fmt(endOfQuarter(now)) },
    { key: "ytd", label: "YTD", start: fmt(startOfYear(now)), end: fmt(now) },
    { key: "all", label: "All time", start: ALL_TIME_START, end: fmt(now) },
  ];

  function go(next: { tab?: Tab; start?: string; end?: string; account?: string; asOf?: string }) {
    const params = new URLSearchParams();
    params.set("tab", next.tab ?? tab);
    params.set("start", next.start ?? start);
    params.set("end", next.end ?? end);
    const nextAccount = next.account !== undefined ? next.account : account;
    if (nextAccount) params.set("account", nextAccount);
    const nextAsOf = next.asOf !== undefined ? next.asOf : asOf;
    if (nextAsOf) params.set("asOf", nextAsOf);
    startTransition(() => router.push(`/reports?${params.toString()}`, { scroll: false }));
  }

  // Export mirrors the visible statement; "By month" has no CSV type, so fall
  // back to the P&L for the selected range.
  const exportParams = new URLSearchParams();
  exportParams.set("type", tab === "monthly" ? "pl" : tab);
  exportParams.set("start", start);
  exportParams.set("end", end);
  if ((tab === "pl" || tab === "cashflow" || tab === "monthly") && account) {
    exportParams.set("account", account);
  }
  if (tab === "balance" && asOf) exportParams.set("asOf", asOf);
  const exportHref = `/api/export?${exportParams.toString()}`;

  const showAccountFilter = tab === "pl" || tab === "cashflow";

  return (
    <div className={clsx("space-y-3 transition-opacity", pending && "pointer-events-none opacity-60")}>
      {/* Tab switcher — segmented control */}
      <div className="inline-flex w-full rounded-2xl bg-black/5 p-1 dark:bg-white/10 sm:w-auto">
        {TABS.map((t) => {
          const active = t.key === tab;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => go({ tab: t.key })}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition sm:flex-none",
                active ? "bg-[var(--card)] text-[var(--text)] shadow-sm" : "muted hover:text-[var(--text)]"
              )}
            >
              <Icon size={15} className="hidden sm:block" />
              <span className="whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Range / as-of + account filter + export */}
      <div className="flex flex-wrap items-center gap-2">
        {tab === "balance" ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="muted flex items-center gap-1.5">
              <CalendarDays size={14} />
              As of
            </span>
            <input
              type="date"
              value={asOf}
              max={fmt(now)}
              onChange={(e) => go({ asOf: e.target.value || fmt(now) })}
              className="input h-9 w-auto py-1"
            />
          </label>
        ) : tab === "monthly" ? (
          <span className="chip bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300">
            <CalendarRange size={13} />
            Last 6 months
          </span>
        ) : (
          <div className="no-scrollbar -mx-1 flex items-center gap-1.5 overflow-x-auto px-1">
            {presets.map((p) => {
              const active = p.start === start && p.end === end;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => go({ start: p.start, end: p.end })}
                  className={clsx(
                    "chip whitespace-nowrap transition",
                    active
                      ? "bg-brand-500/15 text-brand-700 dark:text-brand-300"
                      : "muted bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

        {showAccountFilter && accounts.length > 0 && (
          <label className="relative flex items-center">
            <Wallet size={14} className="muted pointer-events-none absolute left-3" />
            <select
              value={account}
              onChange={(e) => go({ account: e.target.value })}
              className="input h-9 w-auto py-1 pl-8 pr-3"
              aria-label="Filter by account"
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <a href={exportHref} download className="btn-ghost ml-auto shrink-0">
          <Download size={16} />
          <span className="hidden sm:inline">Export</span> CSV
        </a>
      </div>
    </div>
  );
}
