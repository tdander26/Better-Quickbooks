"use client";

// The Categorize Cockpit — a pixel-faithful build of the design handoff, wired to
// real data and the real APIs:
//   - Smart batches -> POST /api/transactions/bulk  { action: "setCategory" }  ("File all N")
//   - Power-grid inline filing / suggestions -> PATCH /api/transactions/:id  { categoryId }
//   - "+ New category" -> POST /api/categories then file
//   - Undo last -> reverse the most recent filing back to Uncategorized
// Colors, spacing, radii, and typography follow the tokens in the handoff exactly
// (inline styles with literal hex, so fidelity doesn't depend on utility classes).

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isActive } from "@/components/nav";
import type {
  CockpitData,
  CockpitTxn,
  CockpitBatch,
  CockpitActivity,
  Confidence,
} from "@/lib/cockpit";

// ---- tokens (mirror src/app/globals.css) ------------------------------------
const T = {
  bg: "#FAF9F6",
  card: "#FDFCFA",
  warm: "#F4F1EA",
  hover: "#F1EDE5",
  hoverSoft: "#F6F3EC",
  border: "#E9E5DE",
  hair: "#EFEBE3",
  ink: "#1C1A17",
  muted: "#6E695D",
  faint: "#8D8778",
  dim: "#C9C2B3",
  accent: "#2A6B4F",
  tintBg: "#E4EEE8",
  tintBorder: "#BFD5C9",
  tintText: "#21543E",
  amber: "#8A6D1F",
  amberBorder: "#E2D5A8",
  red: "#B4543E",
  redBg: "#F5E6E1",
  onDark: "#F4F1EA",
  onDarkMuted: "#A39D8E",
  darkDivider: "#55503F",
  serif: "'Instrument Serif', Georgia, serif",
} as const;

let activitySeq = 0;
const nextActivityId = () => `local-${activitySeq++}`;

type PendingUndo =
  | { kind: "one"; txn: CockpitTxn; index: number; categoryName: string; amountCents: number; activityId: string }
  | { kind: "batch"; batch: CockpitBatch; activityId: string };

// signed "−18.40" (string) -> integer cents
function parseSignedCents(s: string): number {
  const neg = s.trim().startsWith("−") || s.trim().startsWith("-");
  const n = parseFloat(s.replace(/[−,\s+]/g, "").replace(/^-/, ""));
  const cents = Math.round((isNaN(n) ? 0 : n) * 100);
  return neg ? -cents : cents;
}
function fmtUSD(cents: number, showCents = false): string {
  const v = Math.abs(cents) / 100;
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  })}`;
}

async function api(url: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}
async function patchTxn(id: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function Cockpit({ data }: { data: CockpitData }) {
  const pathname = usePathname();
  const [categories, setCategories] = useState(data.categories);
  const [batches, setBatches] = useState<CockpitBatch[]>(data.batches);
  const [oneOffs, setOneOffs] = useState<CockpitTxn[]>(data.oneOffs);
  const [activity, setActivity] = useState<CockpitActivity[]>(data.recent);
  const [filed, setFiled] = useState(0);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // Power-grid keyboard/pointer state.
  const [activeId, setActiveId] = useState<string | null>(data.oneOffs[0]?.id ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const undoRef = useRef<PendingUndo | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const remaining = oneOffs.length + batches.reduce((n, b) => n + b.count, 0);
  const denom = filed + remaining;
  const progressPct = denom === 0 ? 100 : Math.round((filed / denom) * 100);

  const addTally = useCallback((name: string, cents: number, dir: 1 | -1) => {
    setTally((prev) => {
      const next = { ...prev };
      next[name] = (next[name] ?? 0) + dir * Math.abs(cents);
      if (next[name] <= 0) delete next[name];
      return next;
    });
  }, []);

  // ---- File one one-off row ----
  const fileOne = useCallback(
    async (txn: CockpitTxn, categoryId: string, categoryName: string) => {
      if (busy) return;
      setBusy(true);
      const ok = await patchTxn(txn.id, { categoryId });
      setBusy(false);
      if (!ok) return;

      const idx = oneOffs.findIndex((t) => t.id === txn.id);
      const cents = parseSignedCents(txn.amount);
      const activityId = nextActivityId();
      const newList = oneOffs.filter((t) => t.id !== txn.id);

      setOneOffs(newList);
      setFiled((f) => f + 1);
      addTally(categoryName, cents, 1);
      setActivity((prev) => [
        {
          id: activityId,
          name: txn.payee,
          meta: txn.inflow ? `${categoryName} · today` : `Filed → ${categoryName} · today`,
          amount: `${txn.inflow ? "+" : "−"}${fmtUSD(cents, true)}`,
          tone: txn.inflow ? "accent" : "ink",
        },
        ...prev,
      ]);

      undoRef.current = { kind: "one", txn, index: idx, categoryName, amountCents: cents, activityId };
      setCanUndo(Boolean(data.uncategorizedId));

      // Advance to the next unfiled row and keep the flow going.
      const nextActive = newList[Math.min(idx, newList.length - 1)]?.id ?? null;
      setActiveId(nextActive);
      setQuery("");
      setHighlight(0);
      setPickerOpen(Boolean(nextActive));
      if (nextActive) requestAnimationFrame(() => inputRef.current?.focus());
    },
    [busy, oneOffs, addTally, data.uncategorizedId],
  );

  // ---- Create a category from typed text, then file ----
  const createAndFile = useCallback(
    async (txn: CockpitTxn, name: string) => {
      if (busy) return;
      setBusy(true);
      let created: { id: string; name: string; section: string } | null = null;
      try {
        const r = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, section: "expense" }),
        });
        if (r.ok) created = (await r.json()).category;
      } catch {
        /* ignore */
      }
      setBusy(false);
      if (!created) return;
      setCategories((prev) => [...prev, { id: created!.id, name: created!.name, section: created!.section }]);
      await fileOne(txn, created.id, created.name);
    },
    [busy, fileOne],
  );

  // ---- File a whole Smart batch ----
  const fileBatch = useCallback(
    async (batch: CockpitBatch) => {
      if (busy) return;
      setBusy(true);
      const ok = await api("/api/transactions/bulk", {
        action: "setCategory",
        ids: batch.txnIds,
        categoryId: batch.suggestedCategoryId,
      });
      setBusy(false);
      if (!ok) return;

      const totalCents = batch.members.reduce((n, m) => n + parseSignedCents(m.amount), 0);
      const activityId = nextActivityId();
      setBatches((prev) => prev.filter((b) => b.key !== batch.key));
      setFiled((f) => f + batch.count);
      addTally(batch.suggestedCategoryName, totalCents, 1);
      setActivity((prev) => [
        {
          id: activityId,
          name: `${batch.title} ×${batch.count}`,
          meta: `Filed → ${batch.suggestedCategoryName} · today`,
          amount: `${batch.totalInflow ? "+" : "−"}${fmtUSD(totalCents, false)}`,
          tone: batch.totalInflow ? "accent" : "ink",
        },
        ...prev,
      ]);
      undoRef.current = { kind: "batch", batch, activityId };
      setCanUndo(Boolean(data.uncategorizedId));
    },
    [busy, addTally, data.uncategorizedId],
  );

  // ---- Undo the most recent filing ----
  const undoLast = useCallback(async () => {
    const u = undoRef.current;
    if (!u || !data.uncategorizedId || busy) return;
    setBusy(true);
    if (u.kind === "one") {
      const ok = await patchTxn(u.txn.id, { categoryId: data.uncategorizedId, reviewed: false });
      setBusy(false);
      if (!ok) return;
      setOneOffs((prev) => {
        const next = [...prev];
        next.splice(Math.min(u.index, next.length), 0, u.txn);
        return next;
      });
      setFiled((f) => Math.max(0, f - 1));
      addTally(u.categoryName, u.amountCents, -1);
    } else {
      const results = await Promise.all(
        u.batch.txnIds.map((id) => patchTxn(id, { categoryId: data.uncategorizedId, reviewed: false })),
      );
      setBusy(false);
      if (!results.every(Boolean)) return;
      setBatches((prev) => [u.batch, ...prev]);
      setFiled((f) => Math.max(0, f - u.batch.count));
      const totalCents = u.batch.members.reduce((n, m) => n + parseSignedCents(m.amount), 0);
      addTally(u.batch.suggestedCategoryName, totalCents, -1);
    }
    setActivity((prev) => prev.filter((a) => a.id !== u.activityId));
    undoRef.current = null;
    setCanUndo(false);
  }, [busy, data.uncategorizedId, addTally]);

  // ---- Pull a flagged item out of a batch into the one-offs ----
  const pullOut = useCallback((batch: CockpitBatch, memberId: string) => {
    setBatches((prev) =>
      prev
        .map((b) => {
          if (b.key !== batch.key) return b;
          const member = b.members.find((m) => m.id === memberId);
          if (!member) return b;
          const members = b.members.filter((m) => m.id !== memberId);
          const txnIds = b.txnIds.filter((id) => id !== memberId);
          return { ...b, members, txnIds, count: members.length, flag: null };
        })
        .filter((b) => b.count >= 1),
    );
    const member = batch.members.find((m) => m.id === memberId);
    if (member) setOneOffs((prev) => [member, ...prev]);
  }, []);

  // ---- Category type-ahead options for the active row ----
  const activeTxn = oneOffs.find((t) => t.id === activeId) ?? null;
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = categories;
    if (q) list = categories.filter((c) => c.name.toLowerCase().includes(q));
    else if (activeTxn?.suggestedCategoryId) {
      // Empty query: float the suggestion to the top.
      const sug = categories.find((c) => c.id === activeTxn.suggestedCategoryId);
      list = sug ? [sug, ...categories.filter((c) => c.id !== sug.id)] : categories;
    }
    return list.slice(0, 8);
  }, [query, categories, activeTxn?.suggestedCategoryId]);

  const canCreate = query.trim().length > 0 && !categories.some((c) => c.name.toLowerCase() === query.trim().toLowerCase());
  const optionCount = options.length + (canCreate ? 1 : 0);

  const commitIndex = useCallback(
    (i: number) => {
      if (!activeTxn) return;
      if (i < options.length) {
        const c = options[i];
        fileOne(activeTxn, c.id, c.name);
      } else if (canCreate) {
        createAndFile(activeTxn, query.trim());
      }
    },
    [activeTxn, options, canCreate, query, fileOne, createAndFile],
  );

  const openPickerFor = useCallback((id: string) => {
    setActiveId(id);
    setPickerOpen(true);
    setQuery("");
    setHighlight(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, optionCount - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitIndex(highlight);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPickerOpen(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "236px 1fr 320px",
        height: "100vh",
        minHeight: 720,
        background: T.bg,
        color: T.ink,
        fontFamily: "var(--font-sans)",
        fontSize: 14,
        overflow: "hidden",
      }}
    >
      {/* ============ LEFT PANE: NAV + ACCOUNTS ============ */}
      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          borderRight: `1px solid ${T.border}`,
          padding: "26px 18px 18px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 8px 26px" }}>
          <span style={{ fontFamily: T.serif, fontSize: 25, letterSpacing: "-0.5px" }}>Ledger</span>
          <span style={{ fontSize: 10.5, color: T.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Anderson LLC
          </span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 10px",
                  borderRadius: 7,
                  textDecoration: "none",
                  fontWeight: active ? 600 : 400,
                  color: active ? T.ink : T.muted,
                  background: active ? "#EFEAE0" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = T.hover;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon size={16} strokeWidth={active ? 2.25 : 1.75} />
                  {item.label}
                </span>
                {item.hot && data.navBadge > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      background: T.accent,
                      color: "#FAF9F6",
                      borderRadius: 99,
                      padding: "1px 7px",
                    }}
                  >
                    {data.navBadge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          <div
            style={{
              fontSize: 10.5,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: T.faint,
              padding: "20px 10px 10px",
              borderTop: `1px solid ${T.border}`,
            }}
          >
            Accounts
          </div>
          {data.accounts.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                borderRadius: 7,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontWeight: 500 }}>{a.name}</span>
                <span style={{ fontSize: 11.5, color: T.faint }}>{a.detail}</span>
              </div>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500, color: a.negative ? T.red : T.ink }}>
                {a.negative ? `−${a.balance}` : a.balance}
              </span>
            </div>
          ))}
          <Link
            href="/accounts"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 10px 0",
              color: T.faint,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Connect account
          </Link>
        </div>
      </aside>

      {/* ============ CENTER PANE: CATEGORIZE WORKSPACE ============ */}
      <main style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <header style={{ padding: "24px 30px 16px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: T.serif, fontSize: 28, letterSpacing: "-0.5px" }}>Categorize</div>
              <div style={{ fontSize: 12.5, color: T.faint, paddingTop: 4 }}>
                {remaining} left to review · {filed} filed today
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ width: 132, height: 6, background: T.border, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${progressPct}%`, height: "100%", background: T.accent, borderRadius: 99, transition: "width .3s" }} />
                </div>
                <span style={{ fontSize: 12, color: T.muted, fontVariantNumeric: "tabular-nums" }}>{progressPct}%</span>
              </div>
              <Link href="/rules" style={btnGhost}>
                Rules
              </Link>
            </div>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 30px 24px" }}>
          {/* SMART BATCHES */}
          {batches.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={sectionLabel}>Smart batches</span>
                  <span
                    style={{
                      fontSize: 12,
                      color: T.accent,
                      background: T.tintBg,
                      borderRadius: 99,
                      padding: "3px 10px",
                      fontWeight: 500,
                    }}
                  >
                    {data.grouped} grouped · one tap files each set
                  </span>
                </div>
                <Link href="/rules" style={{ fontSize: 12, color: T.faint, textDecoration: "none" }}>
                  Batch settings
                </Link>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 26 }}>
                {batches.map((b) => (
                  <BatchCard
                    key={b.key}
                    batch={b}
                    expanded={!!expanded[b.key]}
                    busy={busy}
                    onToggle={() => setExpanded((e) => ({ ...e, [b.key]: !e[b.key] }))}
                    onFile={() => fileBatch(b)}
                    onFlag={(id) => pullOut(b, id)}
                  />
                ))}
              </div>
            </>
          )}

          {/* ONE-OFFS — POWER GRID */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={sectionLabel}>One-offs</span>
              <span style={{ fontSize: 12, color: T.faint }}>{oneOffs.length} to file individually</span>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <span style={pillBtn}>⌕ Filter</span>
              <span style={pillBtn}>Sort: newest</span>
            </div>
          </div>

          {oneOffs.length > 0 ? (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", background: T.card }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID_COLS,
                  padding: "8px 16px",
                  fontSize: 10.5,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: T.faint,
                  background: T.warm,
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span>Date</span>
                <span>Description</span>
                <span style={{ textAlign: "right", paddingRight: 16 }}>Amount</span>
                <span>Category</span>
                <span />
              </div>

              {oneOffs.map((t) => (
                <GridRow
                  key={t.id}
                  txn={t}
                  active={t.id === activeId}
                  pickerOpen={pickerOpen && t.id === activeId}
                  query={query}
                  options={options}
                  highlight={highlight}
                  canCreate={canCreate}
                  inputRef={inputRef}
                  onActivate={() => openPickerFor(t.id)}
                  onQuickFile={() => {
                    if (t.suggestedCategoryId && t.suggestedCategoryName) {
                      fileOne(t, t.suggestedCategoryId, t.suggestedCategoryName);
                    } else {
                      openPickerFor(t.id);
                    }
                  }}
                  onQueryChange={(v) => {
                    setQuery(v);
                    setHighlight(0);
                  }}
                  onKey={onInputKey}
                  onHover={(i) => setHighlight(i)}
                  onPick={(i) => commitIndex(i)}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: 12,
                background: T.card,
                padding: "34px 16px",
                textAlign: "center",
                color: T.faint,
                fontSize: 13,
              }}
            >
              {batches.length > 0 ? "No one-offs — file the batches above." : "All caught up. Nothing left to review. 🎉"}
            </div>
          )}
        </div>

        {/* DARK RUNNING-TALLY FOOTER */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "11px 30px",
            background: T.ink,
            color: T.onDarkMuted,
            fontSize: 12,
            flex: "none",
          }}
        >
          <span style={{ color: T.onDark, fontWeight: 600 }}>{filed} filed today</span>
          {Object.entries(tally)
            .slice(0, 5)
            .map(([name, cents]) => (
              <span key={name}>
                {name} <span style={{ color: T.onDark, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(cents)}</span>
              </span>
            ))}
          {Object.keys(tally).length === 0 && <span>Filed categories tally up here.</span>}
          <span
            onClick={canUndo ? undoLast : undefined}
            style={{
              marginLeft: "auto",
              borderBottom: `1px solid ${T.darkDivider}`,
              cursor: canUndo ? "pointer" : "default",
              color: canUndo ? T.onDarkMuted : "#6a6455",
            }}
          >
            Undo last
          </span>
        </div>
      </main>

      {/* ============ RIGHT PANE: ATTENTION + ACTIVITY ============ */}
      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: `1px solid ${T.border}`,
          background: T.warm,
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "26px 22px 8px" }}>
          <div style={{ ...uppercaseLabel, paddingBottom: 13 }}>Needs attention</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.attention.length === 0 && (
              <div style={{ fontSize: 12.5, color: T.faint }}>Nothing needs attention right now.</div>
            )}
            {data.attention.map((task) => (
              <div
                key={task.id}
                style={{
                  background: T.card,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: "13px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{task.title}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: task.tagTone === "red" ? T.red : task.tagTone === "accent" ? T.accent : T.muted,
                    }}
                  >
                    {task.tag}
                  </span>
                </div>
                <span style={{ fontSize: 12.5, color: T.faint, lineHeight: 1.45 }}>{task.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "22px 22px 22px", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 6 }}>
            <span style={uppercaseLabel}>Recent activity</span>
            <Link href="/transactions" style={{ fontSize: 12, color: T.faint, textDecoration: "none" }}>
              All →
            </Link>
          </div>
          {activity.map((tx) => (
            <div
              key={tx.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 0",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: 500,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {tx.name}
                </span>
                <span style={{ fontSize: 11.5, color: T.faint }}>{tx.meta}</span>
              </div>
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 13,
                  fontWeight: 500,
                  color: tx.tone === "accent" ? T.accent : tx.tone === "muted" ? T.muted : T.ink,
                  whiteSpace: "nowrap",
                }}
              >
                {tx.amount}
              </span>
            </div>
          ))}
        </div>

        <div style={{ padding: "0 22px 22px" }}>
          <div
            style={{
              background: T.ink,
              color: T.onDark,
              borderRadius: 12,
              padding: "15px 17px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 12, color: T.onDarkMuted }}>{data.tax.label}</span>
              <span style={{ fontSize: 11, color: T.onDarkMuted }}>{data.tax.due}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: T.serif, fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{data.tax.amount}</span>
              <Link
                href="/reports"
                style={{ fontSize: 12, fontWeight: 500, color: T.onDark, textDecoration: "none", borderBottom: `1px solid ${T.darkDivider}` }}
              >
                Review
              </Link>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
const GRID_COLS = "62px 1fr 96px 188px 32px";

const btnGhost: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  padding: "8px 15px",
  borderRadius: 8,
  border: `1px solid ${T.dim}`,
  background: "transparent",
  color: T.ink,
  textDecoration: "none",
  cursor: "pointer",
};
const sectionLabel: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: T.faint,
};
const uppercaseLabel: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: T.faint,
};
const pillBtn: CSSProperties = {
  fontSize: 12,
  padding: "5px 11px",
  borderRadius: 7,
  border: `1px solid ${T.dim}`,
  color: T.muted,
  cursor: "pointer",
};

// ---- Smart batch card ------------------------------------------------------
function BatchCard({
  batch,
  expanded,
  busy,
  onToggle,
  onFile,
  onFlag,
}: {
  batch: CockpitBatch;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onFile: () => void;
  onFlag: (id: string) => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        background: T.card,
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(28,26,23,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px" }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: batch.avatarBg,
            color: batch.avatarColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: 13,
            flex: "none",
          }}
        >
          {batch.initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {batch.title} <span style={{ fontWeight: 400, color: T.faint }}>× {batch.count}</span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: T.faint,
              paddingTop: 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 2, background: batch.catDot }} />
            {batch.sub}
          </div>
        </div>
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            fontWeight: 500,
            color: batch.totalInflow ? T.accent : T.ink,
            whiteSpace: "nowrap",
          }}
        >
          {batch.total}
        </span>
        <button
          onClick={onFile}
          disabled={busy}
          style={{
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 600,
            padding: "8px 15px",
            borderRadius: 8,
            border: "none",
            background: T.accent,
            color: "#FAF9F6",
            cursor: busy ? "default" : "pointer",
            whiteSpace: "nowrap",
            opacity: busy ? 0.6 : 1,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
        >
          {batch.cta}
        </button>
        <span onClick={onToggle} style={{ fontSize: 12, color: T.faint, cursor: "pointer", padding: "0 2px" }}>
          {expanded ? "⌃" : "⌄"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, padding: "0 15px 13px 61px", flexWrap: "wrap" }}>
        {(expanded ? batch.members.map((m) => ({ id: m.id, label: `${m.date} · ${m.amount}` })) : batch.items).map(
          (it) => (
            <span
              key={it.id}
              style={{
                fontSize: 11.5,
                color: T.muted,
                background: T.hover,
                borderRadius: 6,
                padding: "3px 9px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {it.label}
            </span>
          ),
        )}
        {batch.flag && (
          <span
            onClick={() => onFlag(batch.flag!.id)}
            title="Pull this one out to handle individually"
            style={{
              fontSize: 11.5,
              color: T.red,
              background: T.redBg,
              borderRadius: 6,
              padding: "3px 9px",
              cursor: "pointer",
            }}
          >
            ⚑ {batch.flag.text}
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Power-grid row --------------------------------------------------------
function suggestionPillStyle(confidence: Confidence): CSSProperties {
  if (confidence === "high") return { border: `1px dashed ${T.tintBorder}`, color: T.accent };
  if (confidence === "medium") return { border: `1px dashed ${T.amberBorder}`, color: T.amber };
  return { border: `1px dashed ${T.dim}`, color: T.faint };
}

function GridRow({
  txn,
  active,
  pickerOpen,
  query,
  options,
  highlight,
  canCreate,
  inputRef,
  onActivate,
  onQuickFile,
  onQueryChange,
  onKey,
  onHover,
  onPick,
}: {
  txn: CockpitTxn;
  active: boolean;
  pickerOpen: boolean;
  query: string;
  options: { id: string; name: string }[];
  highlight: number;
  canCreate: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onActivate: () => void;
  onQuickFile: () => void;
  onQueryChange: (v: string) => void;
  onKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
}) {
  const label = txn.suggestedCategoryName
    ? `${txn.suggestedCategoryName}?`
    : "Choose…";

  return (
    <div
      onClick={active ? undefined : onActivate}
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        alignItems: "center",
        padding: "10px 16px",
        borderBottom: `1px solid ${T.hair}`,
        fontVariantNumeric: "tabular-nums",
        background: active ? T.hover : "transparent",
        boxShadow: active ? `inset 3px 0 0 ${T.accent}` : "none",
        position: "relative",
        zIndex: active && pickerOpen ? 3 : "auto",
        cursor: active ? "default" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = T.hoverSoft;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: 12, color: T.faint }}>{txn.date}</span>
      <span style={{ fontWeight: active ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>
        {txn.payee}
      </span>
      <span style={{ textAlign: "right", paddingRight: 16, fontWeight: 500, color: txn.inflow ? T.accent : T.ink }}>
        {txn.amount}
      </span>

      {/* Category cell */}
      <span style={{ position: "relative" }}>
        {pickerOpen ? (
          <>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: T.card,
                border: `1.5px solid ${T.accent}`,
                borderRadius: 7,
                padding: "5px 10px",
                fontSize: 12.5,
              }}
            >
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={onKey}
                placeholder="Type to file…"
                style={{
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  font: "inherit",
                  color: T.ink,
                  width: "100%",
                  padding: 0,
                }}
              />
              <span style={{ color: T.faint }}>⌄</span>
            </span>
            <span
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                width: 208,
                background: T.card,
                border: `1px solid ${T.dim}`,
                borderRadius: 9,
                boxShadow: "0 10px 28px rgba(28,26,23,0.16)",
                zIndex: 20,
                padding: 5,
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {options.map((c, i) => {
                const on = i === highlight;
                return (
                  <span
                    key={c.id}
                    onMouseEnter={() => onHover(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick(i);
                    }}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "7px 10px",
                      borderRadius: 6,
                      background: on ? T.tintBg : "transparent",
                      color: on ? T.tintText : T.muted,
                      fontWeight: on ? 600 : 400,
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    <span>{highlightMatch(c.name, query)}</span>
                    {on && <span style={{ fontSize: 11, fontWeight: 400 }}>↵</span>}
                  </span>
                );
              })}
              {canCreate && (
                <span
                  onMouseEnter={() => onHover(options.length)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(options.length);
                  }}
                  style={{
                    display: "block",
                    padding: "7px 10px",
                    fontSize: 12,
                    color: options.length === highlight ? T.tintText : T.faint,
                    background: options.length === highlight ? T.tintBg : "transparent",
                    borderTop: `1px solid ${T.hair}`,
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  + New category “{query.trim()}”
                </span>
              )}
              {options.length === 0 && !canCreate && (
                <span style={{ display: "block", padding: "7px 10px", fontSize: 12, color: T.faint }}>No matches</span>
              )}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 12.5 }}>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onQuickFile();
              }}
              title={txn.reason ?? undefined}
              style={{
                ...suggestionPillStyle(txn.confidence),
                borderRadius: 7,
                padding: "4px 10px",
                cursor: "pointer",
                display: "inline-block",
              }}
            >
              {label}
            </span>
          </span>
        )}
      </span>

      <span style={{ color: T.dim, textAlign: "center" }}>·</span>
    </div>
  );
}

// Bold/underline the matched prefix of a category name against the query.
function highlightMatch(name: string, query: string) {
  const q = query.trim();
  if (!q) return name;
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <u style={{ textDecorationColor: "#7FA890" }}>{name.slice(idx, idx + q.length)}</u>
      {name.slice(idx + q.length)}
    </>
  );
}
