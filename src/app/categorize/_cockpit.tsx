"use client";

// The Categorize Cockpit — a pixel-faithful build of the design handoff, wired to
// real data and the real APIs:
//   - Smart batches -> POST /api/transactions/bulk  { action: "setCategory" }  ("File all N")
//   - Power-grid inline filing / suggestions -> PATCH /api/transactions/:id  { categoryId }
//   - "+ New category" -> POST /api/categories then file
//   - Undo last -> reverse the most recent filing back to Uncategorized
// Colors, spacing, radii, and typography follow the tokens in the handoff exactly
// (inline styles with literal hex, so fidelity doesn't depend on utility classes).

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, MOBILE_NAV, isActive } from "@/components/nav";
import type {
  CockpitData,
  CockpitTxn,
  CockpitBatch,
  CockpitActivity,
  CockpitCategory,
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
  serif: "var(--font-serif)",
} as const;

let activitySeq = 0;
const nextActivityId = () => `local-${activitySeq++}`;

type PendingUndo =
  | { kind: "one"; txn: CockpitTxn; index: number; categoryName: string; amountCents: number; activityId: string }
  | { kind: "batch"; batch: CockpitBatch; activityId: string }
  | { kind: "member"; member: CockpitTxn; categoryName: string; amountCents: number; activityId: string };

// A group needs at least this many members to stay a batch; below it, the
// leftovers dissolve into one-offs (mirrors MIN_BATCH in src/lib/cockpit.ts).
const MIN_BATCH = 2;

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

  // Smart-batch category editing (desktop dropdown / mobile sheet share this key).
  const [batchPickerKey, setBatchPickerKey] = useState<string | null>(null);
  const [batchQuery, setBatchQuery] = useState("");

  // Per-member category editing inside an expanded batch (change one, not all).
  const [memberPickerId, setMemberPickerId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");

  // Rule-suggestion editor.
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [dismissedAttention, setDismissedAttention] = useState<Set<string>>(new Set());
  const [ruleDraft, setRuleDraft] = useState(() => {
    const rs = data.ruleSuggestion;
    return {
      name: rs?.defaultName ?? "",
      matchField: "payee",
      operator: "contains",
      value: rs?.payee ?? "",
      categoryId: rs?.categoryId ?? "",
    };
  });

  // Mobile: a bottom-sheet category picker replaces the desktop inline grid.
  const isMobile = useIsMobile();
  const [sheetTxn, setSheetTxn] = useState<CockpitTxn | null>(null);
  const [sheetQuery, setSheetQuery] = useState("");

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

      // Move the active-row highlight to the next unfiled row, but keep its
      // picker CLOSED — the user opens a picker deliberately by clicking.
      const nextActive = newList[Math.min(idx, newList.length - 1)]?.id ?? null;
      setActiveId(nextActive);
      setQuery("");
      setHighlight(0);
      setPickerOpen(false);
    },
    [busy, oneOffs, addTally, data.uncategorizedId],
  );

  // ---- Create a category, register it in local state, and return it ----
  const createCategory = useCallback(async (name: string): Promise<CockpitCategory | null> => {
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
    if (!created) return null;
    const cat: CockpitCategory = { id: created.id, name: created.name, section: created.section };
    setCategories((prev) => [...prev, cat]);
    return cat;
  }, []);

  // ---- Create a category from typed text, then file ----
  const createAndFile = useCallback(
    async (txn: CockpitTxn, name: string) => {
      if (busy) return;
      setBusy(true);
      const cat = await createCategory(name);
      setBusy(false);
      if (!cat) return;
      await fileOne(txn, cat.id, cat.name);
    },
    [busy, createCategory, fileOne],
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
    } else if (u.kind === "member") {
      const ok = await patchTxn(u.member.id, { categoryId: data.uncategorizedId, reviewed: false });
      setBusy(false);
      if (!ok) return;
      // Restore it as a one-off (the batch may have moved on since).
      setOneOffs((prev) => [u.member, ...prev]);
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

  // ---- Change a batch's target category (before filing) ----
  const setBatchCategory = useCallback((batch: CockpitBatch, cat: { id: string; name: string }) => {
    setBatches((prev) =>
      prev.map((b) =>
        b.key !== batch.key
          ? b
          : {
              ...b,
              suggestedCategoryId: cat.id,
              suggestedCategoryName: cat.name,
              sub: b.totalInflow ? `Deposits → ${cat.name}` : `→ ${cat.name}`,
              cta: `File all ${b.count}`,
            },
      ),
    );
    setBatchPickerKey(null);
    setBatchQuery("");
  }, []);

  // ---- Dismiss a batch: break it into individual one-offs (nothing is lost) ----
  const dismissBatch = useCallback(
    (batch: CockpitBatch) => {
      setOneOffs((prev) => [...batch.members, ...prev]);
      setBatches((prev) => prev.filter((b) => b.key !== batch.key));
      setBatchPickerKey((k) => (k === batch.key ? null : k));
    },
    [],
  );

  // ---- File ONE member of a batch individually (change one, not all) ----
  const fileMember = useCallback(
    async (batch: CockpitBatch, member: CockpitTxn, categoryId: string, categoryName: string) => {
      if (busy) return;
      setBusy(true);
      const ok = await patchTxn(member.id, { categoryId });
      setBusy(false);
      if (!ok) return;

      const cents = parseSignedCents(member.amount);
      const remaining = batch.members.filter((m) => m.id !== member.id);

      if (remaining.length >= MIN_BATCH) {
        const totalCents = remaining.reduce((n, m) => n + parseSignedCents(m.amount), 0);
        const totalInflow = totalCents >= 0;
        setBatches((prev) =>
          prev.map((b) =>
            b.key !== batch.key
              ? b
              : {
                  ...b,
                  members: remaining,
                  txnIds: remaining.map((m) => m.id),
                  count: remaining.length,
                  total: `${totalInflow ? "+" : "−"}${fmtUSD(totalCents, true)}`,
                  totalInflow,
                  cta: `File all ${remaining.length}`,
                  flag: b.flag && b.flag.id === member.id ? null : b.flag,
                },
          ),
        );
      } else {
        // Too few left to stay a batch — dissolve the rest into one-offs.
        setBatches((prev) => prev.filter((b) => b.key !== batch.key));
        if (remaining.length) setOneOffs((prev) => [...remaining, ...prev]);
      }

      const activityId = nextActivityId();
      setFiled((f) => f + 1);
      addTally(categoryName, cents, 1);
      setActivity((prev) => [
        {
          id: activityId,
          name: member.payee,
          meta: member.inflow ? `${categoryName} · today` : `Filed → ${categoryName} · today`,
          amount: `${member.inflow ? "+" : "−"}${fmtUSD(cents, true)}`,
          tone: member.inflow ? "accent" : "ink",
        },
        ...prev,
      ]);
      undoRef.current = { kind: "member", member, categoryName, amountCents: cents, activityId };
      setCanUndo(Boolean(data.uncategorizedId));
      setMemberPickerId(null);
      setMemberQuery("");
    },
    [busy, addTally, data.uncategorizedId],
  );

  // Category options for the batch picker (mirrors the one-off type-ahead).
  const batchPickerBatch = batches.find((b) => b.key === batchPickerKey) ?? null;
  const batchOptions = useMemo(() => {
    const q = batchQuery.trim().toLowerCase();
    if (q) return categories.filter((c) => c.name.toLowerCase().includes(q));
    return categories;
  }, [batchQuery, categories]);
  const batchCanCreate =
    batchQuery.trim().length > 0 &&
    !categories.some((c) => c.name.toLowerCase() === batchQuery.trim().toLowerCase());

  const pickBatchCategory = useCallback(
    (cat: { id: string; name: string }) => {
      if (batchPickerBatch) setBatchCategory(batchPickerBatch, cat);
    },
    [batchPickerBatch, setBatchCategory],
  );
  const createBatchCategory = useCallback(async () => {
    const batch = batchPickerBatch;
    if (!batch || busy) return;
    setBusy(true);
    const cat = await createCategory(batchQuery.trim());
    setBusy(false);
    if (cat) setBatchCategory(batch, cat);
  }, [batchPickerBatch, busy, batchQuery, createCategory, setBatchCategory]);

  // Per-member picker (inside an expanded batch): options + the batch/member the
  // currently-open picker belongs to, derived from the open member id.
  const memberOptions = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (q) return categories.filter((c) => c.name.toLowerCase().includes(q));
    return categories;
  }, [memberQuery, categories]);
  const memberCanCreate =
    memberQuery.trim().length > 0 &&
    !categories.some((c) => c.name.toLowerCase() === memberQuery.trim().toLowerCase());
  const memberPickerCtx = useMemo(() => {
    if (!memberPickerId) return null;
    for (const b of batches) {
      const m = b.members.find((mm) => mm.id === memberPickerId);
      if (m) return { batch: b, member: m };
    }
    return null;
  }, [memberPickerId, batches]);
  const pickMemberCategory = useCallback(
    (cat: { id: string; name: string }) => {
      if (memberPickerCtx) fileMember(memberPickerCtx.batch, memberPickerCtx.member, cat.id, cat.name);
    },
    [memberPickerCtx, fileMember],
  );
  const createMemberCategory = useCallback(async () => {
    if (!memberPickerCtx || busy) return;
    setBusy(true);
    const cat = await createCategory(memberQuery.trim());
    setBusy(false);
    if (cat) fileMember(memberPickerCtx.batch, memberPickerCtx.member, cat.id, cat.name);
  }, [memberPickerCtx, busy, memberQuery, createCategory, fileMember]);

  // ---- Create a rule from the suggestion editor ----
  const createRule = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setRuleError(null);
    let ok = false;
    let errMsg: string | null = null;
    try {
      const r = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ruleDraft.name.trim(),
          matchField: ruleDraft.matchField,
          operator: ruleDraft.operator,
          value: ruleDraft.value.trim(),
          categoryId: ruleDraft.categoryId,
          priority: 100,
          enabled: true,
        }),
      });
      ok = r.ok;
      if (!ok) {
        const j = await r.json().catch(() => null);
        errMsg = j?.error ?? "Could not create the rule.";
      }
    } catch {
      errMsg = "Could not create the rule.";
    }
    setBusy(false);
    if (!ok) {
      setRuleError(errMsg);
      return;
    }
    setRuleEditorOpen(false);
    setDismissedAttention((prev) => new Set(prev).add("rule-suggestion"));
  }, [busy, ruleDraft]);

  const openRuleEditor = useCallback(() => {
    const rs = data.ruleSuggestion;
    if (!rs) return;
    setRuleDraft({
      name: rs.defaultName,
      matchField: "payee",
      operator: "contains",
      value: rs.payee,
      categoryId: rs.categoryId,
    });
    setRuleError(null);
    setRuleEditorOpen(true);
  }, [data.ruleSuggestion]);

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

  // Skip past a row without filing: move the highlight to the next (or previous)
  // row and keep the picker closed. The txn stays in the one-offs list.
  const skipRow = useCallback(
    (id: string) => {
      const idx = oneOffs.findIndex((t) => t.id === id);
      const next = oneOffs[idx + 1] ?? oneOffs[idx - 1] ?? null;
      setActiveId(next?.id ?? null);
      setPickerOpen(false);
      setQuery("");
      setHighlight(0);
    },
    [oneOffs],
  );

  // ---- Mobile bottom-sheet picker ----
  const sheetOptions = useMemo(() => {
    const q = sheetQuery.trim().toLowerCase();
    if (q) return categories.filter((c) => c.name.toLowerCase().includes(q));
    if (sheetTxn?.suggestedCategoryId) {
      const sug = categories.find((c) => c.id === sheetTxn.suggestedCategoryId);
      if (sug) return [sug, ...categories.filter((c) => c.id !== sug.id)];
    }
    return categories;
  }, [sheetQuery, categories, sheetTxn]);

  const sheetCanCreate =
    sheetQuery.trim().length > 0 &&
    !categories.some((c) => c.name.toLowerCase() === sheetQuery.trim().toLowerCase());

  // Advance the sheet to the next one-off (so filing stays a fast, in-place flow).
  const advanceSheet = useCallback(
    (txn: CockpitTxn) => {
      const idx = oneOffs.findIndex((t) => t.id === txn.id);
      const rest = oneOffs.filter((t) => t.id !== txn.id);
      setSheetTxn(rest[Math.min(idx, rest.length - 1)] ?? null);
      setSheetQuery("");
    },
    [oneOffs],
  );

  // After filing from the sheet, CLOSE it — don't auto-jump onto the next
  // transaction. The user re-opens a sheet (or taps Skip) deliberately.
  const pickFromSheet = useCallback(
    (c: { id: string; name: string }) => {
      const txn = sheetTxn;
      if (!txn) return;
      setSheetTxn(null);
      setSheetQuery("");
      void fileOne(txn, c.id, c.name);
    },
    [sheetTxn, fileOne],
  );

  const createFromSheet = useCallback(() => {
    const txn = sheetTxn;
    if (!txn) return;
    const name = sheetQuery.trim();
    setSheetTxn(null);
    setSheetQuery("");
    void createAndFile(txn, name);
  }, [sheetTxn, sheetQuery, createAndFile]);

  const acceptSuggestionMobile = useCallback(() => {
    const txn = sheetTxn;
    if (!txn?.suggestedCategoryId || !txn.suggestedCategoryName) return;
    setSheetTxn(null);
    setSheetQuery("");
    void fileOne(txn, txn.suggestedCategoryId, txn.suggestedCategoryName);
  }, [sheetTxn, fileOne]);

  // Explicit "Skip →": advance the sheet to the next transaction without
  // filing the current one (it stays in the one-offs list).
  const skipSheet = useCallback(() => {
    if (sheetTxn) advanceSheet(sheetTxn);
  }, [sheetTxn, advanceSheet]);

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
    <div className="ck-root">
      {/* ============ LEFT PANE: NAV + ACCOUNTS (desktop) ============ */}
      <aside className="ck-left">
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
      <main className="ck-center">
        {/* Mobile-only brand bar (the desktop left rail is hidden < 900px) */}
        <div className="ck-mobilebar">
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-serif)", fontSize: 22, letterSpacing: "-0.5px" }}>Ledger</span>
            <span style={{ fontSize: 10, color: T.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Anderson LLC
            </span>
          </span>
          <span style={{ fontSize: 12, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
            {remaining} to review
          </span>
        </div>
        <header className="ck-header">
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

        <div className="ck-body">
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
                    onDismiss={() => dismissBatch(b)}
                    onChangeCategory={() => {
                      setBatchPickerKey(b.key);
                      setBatchQuery("");
                    }}
                    desktopPickerOpen={!isMobile && batchPickerKey === b.key}
                    pickerQuery={batchQuery}
                    pickerOptions={batchOptions}
                    pickerCanCreate={batchCanCreate}
                    onPickerQuery={setBatchQuery}
                    onPickCategory={pickBatchCategory}
                    onCreateCategory={createBatchCategory}
                    onClosePicker={() => {
                      setBatchPickerKey(null);
                      setBatchQuery("");
                    }}
                    memberPickerId={memberPickerId}
                    memberPickerQuery={memberQuery}
                    memberPickerOptions={memberOptions}
                    memberPickerCanCreate={memberCanCreate}
                    onOpenMemberPicker={(id) => {
                      setMemberPickerId(id);
                      setMemberQuery("");
                    }}
                    onMemberPickerQuery={setMemberQuery}
                    onPickMemberCategory={pickMemberCategory}
                    onCreateMemberCategory={createMemberCategory}
                    onCloseMemberPicker={() => {
                      setMemberPickerId(null);
                      setMemberQuery("");
                    }}
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

          {oneOffs.length > 0 && isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {oneOffs.map((t) => (
                <MobileTxnCard
                  key={t.id}
                  txn={t}
                  busy={busy}
                  onOpen={() => {
                    setSheetTxn(t);
                    setSheetQuery("");
                  }}
                  onAccept={() => {
                    if (t.suggestedCategoryId && t.suggestedCategoryName) {
                      void fileOne(t, t.suggestedCategoryId, t.suggestedCategoryName);
                    } else {
                      setSheetTxn(t);
                      setSheetQuery("");
                    }
                  }}
                />
              ))}
            </div>
          ) : oneOffs.length > 0 ? (
            <div className="ck-gridwrap">
            <div className="ck-grid" style={{ border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", background: T.card }}>
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
                <span style={{ textAlign: "center" }} />
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
                  onSkip={() => skipRow(t.id)}
                />
              ))}
            </div>
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
        <div className="ck-footer">
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
      <aside className="ck-right">
        <div style={{ padding: "26px 22px 8px" }}>
          <div style={{ ...uppercaseLabel, paddingBottom: 13 }}>Needs attention</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(() => {
              const visible = data.attention.filter((t) => !dismissedAttention.has(t.id));
              if (visible.length === 0)
                return <div style={{ fontSize: 12.5, color: T.faint }}>Nothing needs attention right now.</div>;
              return visible.map((task) => {
                const clickable = task.id === "rule-suggestion" && !!data.ruleSuggestion;
                return (
                  <div
                    key={task.id}
                    onClick={clickable ? openRuleEditor : undefined}
                    style={{
                      background: T.card,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: "13px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      cursor: clickable ? "pointer" : "default",
                    }}
                    onMouseEnter={(e) => {
                      if (clickable) e.currentTarget.style.background = T.hoverSoft;
                    }}
                    onMouseLeave={(e) => {
                      if (clickable) e.currentTarget.style.background = T.card;
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
                    {clickable && (
                      <span style={{ fontSize: 11.5, color: T.accent, fontWeight: 500, paddingTop: 2 }}>
                        Create rule →
                      </span>
                    )}
                  </div>
                );
              });
            })()}
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

      {/* ============ MOBILE BOTTOM TAB BAR (< 900px) ============ */}
      <nav className="ck-mobilenav">
        {MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "8px 0 10px",
                fontSize: 11,
                fontWeight: 500,
                textDecoration: "none",
                color: active ? T.accent : T.muted,
              }}
            >
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              {item.label}
              {item.hot && remaining > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: 4,
                    left: "calc(50% + 8px)",
                    background: T.accent,
                    color: "#FAF9F6",
                    borderRadius: 99,
                    fontSize: 9,
                    fontWeight: 600,
                    padding: "0 5px",
                    lineHeight: "15px",
                  }}
                >
                  {remaining}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ============ MOBILE CATEGORY BOTTOM SHEET ============ */}
      {isMobile && sheetTxn && (
        <MobileCategorySheet
          txn={sheetTxn}
          query={sheetQuery}
          options={sheetOptions}
          canCreate={sheetCanCreate}
          busy={busy}
          onQuery={setSheetQuery}
          onPick={pickFromSheet}
          onCreate={createFromSheet}
          onAccept={acceptSuggestionMobile}
          onSkip={skipSheet}
          onClose={() => setSheetTxn(null)}
        />
      )}

      {/* ============ MOBILE BATCH CATEGORY SHEET ============ */}
      {isMobile && batchPickerBatch && (
        <BatchCategorySheet
          batch={batchPickerBatch}
          query={batchQuery}
          options={batchOptions}
          canCreate={batchCanCreate}
          busy={busy}
          onQuery={setBatchQuery}
          onPick={pickBatchCategory}
          onCreate={createBatchCategory}
          onClose={() => {
            setBatchPickerKey(null);
            setBatchQuery("");
          }}
        />
      )}

      {/* ============ RULE SUGGESTION EDITOR ============ */}
      {ruleEditorOpen && data.ruleSuggestion && (
        <RuleEditor
          draft={ruleDraft}
          categories={categories}
          busy={busy}
          error={ruleError}
          onChange={setRuleDraft}
          onSubmit={createRule}
          onClose={() => setRuleEditorOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const GRID_COLS = "62px 1fr 96px 188px 48px";

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

// ---- Shared category dropdown (desktop) ------------------------------------
// A self-contained type-ahead popover, anchored below its trigger. Used by the
// Smart-batch "Change category" control.
function CategoryDropdown({
  query,
  options,
  canCreate,
  busy,
  onQuery,
  onPick,
  onCreate,
  onClose,
}: {
  query: string;
  options: CockpitCategory[];
  canCreate: boolean;
  busy: boolean;
  onQuery: (v: string) => void;
  onPick: (c: CockpitCategory) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  const shown = options.slice(0, 8);
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        width: 224,
        background: T.card,
        border: `1px solid ${T.dim}`,
        borderRadius: 9,
        boxShadow: "0 10px 28px rgba(28,26,23,0.16)",
        zIndex: 30,
        padding: 6,
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Change category…"
        style={{
          width: "100%",
          fontFamily: "inherit",
          fontSize: 12.5,
          padding: "7px 9px",
          borderRadius: 7,
          border: `1.5px solid ${T.accent}`,
          background: T.card,
          color: T.ink,
          outline: "none",
          marginBottom: 5,
        }}
      />
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {shown.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c)}
            disabled={busy}
            style={{
              width: "100%",
              textAlign: "left",
              fontFamily: "inherit",
              display: "block",
              padding: "7px 10px",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: T.muted,
              fontSize: 12.5,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.tintBg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {highlightMatch(c.name, query)}
          </button>
        ))}
        {canCreate && (
          <button
            onClick={onCreate}
            disabled={busy}
            style={{
              width: "100%",
              textAlign: "left",
              fontFamily: "inherit",
              display: "block",
              padding: "7px 10px",
              fontSize: 12,
              color: T.faint,
              borderTop: `1px solid ${T.hair}`,
              borderLeft: "none",
              borderRight: "none",
              borderBottom: "none",
              background: "transparent",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            + New category “{query.trim()}”
          </button>
        )}
        {shown.length === 0 && !canCreate && (
          <span style={{ display: "block", padding: "7px 10px", fontSize: 12, color: T.faint }}>No matches</span>
        )}
      </div>
    </div>
  );
}

// ---- Smart batch card ------------------------------------------------------
function BatchCard({
  batch,
  expanded,
  busy,
  onToggle,
  onFile,
  onFlag,
  onDismiss,
  onChangeCategory,
  desktopPickerOpen,
  pickerQuery,
  pickerOptions,
  pickerCanCreate,
  onPickerQuery,
  onPickCategory,
  onCreateCategory,
  onClosePicker,
  memberPickerId,
  memberPickerQuery,
  memberPickerOptions,
  memberPickerCanCreate,
  onOpenMemberPicker,
  onMemberPickerQuery,
  onPickMemberCategory,
  onCreateMemberCategory,
  onCloseMemberPicker,
}: {
  batch: CockpitBatch;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onFile: () => void;
  onFlag: (id: string) => void;
  onDismiss: () => void;
  onChangeCategory: () => void;
  desktopPickerOpen: boolean;
  pickerQuery: string;
  pickerOptions: CockpitCategory[];
  pickerCanCreate: boolean;
  onPickerQuery: (v: string) => void;
  onPickCategory: (c: CockpitCategory) => void;
  onCreateCategory: () => void;
  onClosePicker: () => void;
  memberPickerId: string | null;
  memberPickerQuery: string;
  memberPickerOptions: CockpitCategory[];
  memberPickerCanCreate: boolean;
  onOpenMemberPicker: (memberId: string) => void;
  onMemberPickerQuery: (v: string) => void;
  onPickMemberCategory: (c: CockpitCategory) => void;
  onCreateMemberCategory: () => void;
  onCloseMemberPicker: () => void;
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
        <div style={{ position: "relative" }}>
          <button
            onClick={onChangeCategory}
            disabled={busy}
            title="File this set under a different category"
            style={{
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 500,
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${T.dim}`,
              background: "transparent",
              color: T.muted,
              cursor: busy ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Change
          </button>
          {desktopPickerOpen && (
            <CategoryDropdown
              query={pickerQuery}
              options={pickerOptions}
              canCreate={pickerCanCreate}
              busy={busy}
              onQuery={onPickerQuery}
              onPick={onPickCategory}
              onCreate={onCreateCategory}
              onClose={onClosePicker}
            />
          )}
        </div>
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
        <span
          onClick={onDismiss}
          title="Dismiss — break into individual one-offs"
          style={{ fontSize: 15, lineHeight: 1, color: T.faint, cursor: "pointer", padding: "0 2px" }}
        >
          ×
        </span>
      </div>

      {expanded ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 15px 12px 61px" }}>
          {batch.members.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
                borderTop: `1px solid ${T.hover}`,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: T.faint,
                  minWidth: 52,
                  fontVariantNumeric: "tabular-nums",
                  flex: "none",
                }}
              >
                {m.date}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={m.payee}
              >
                {m.payee}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: m.inflow ? T.accent : T.ink,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {m.amount}
              </span>
              <div style={{ position: "relative", flex: "none" }}>
                <button
                  onClick={() => onOpenMemberPicker(m.id)}
                  disabled={busy}
                  title="File just this one under its own category"
                  style={{
                    fontFamily: "inherit",
                    fontSize: 11.5,
                    fontWeight: 500,
                    padding: "5px 10px",
                    borderRadius: 7,
                    border: `1px solid ${T.dim}`,
                    background: "transparent",
                    color: T.muted,
                    cursor: busy ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Change
                </button>
                {memberPickerId === m.id && (
                  <CategoryDropdown
                    query={memberPickerQuery}
                    options={memberPickerOptions}
                    canCreate={memberPickerCanCreate}
                    busy={busy}
                    onQuery={onMemberPickerQuery}
                    onPick={onPickMemberCategory}
                    onCreate={onCreateMemberCategory}
                    onClose={onCloseMemberPicker}
                  />
                )}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11, color: T.faint, paddingTop: 6 }}>
            Change one above to file it on its own, or use “{batch.cta}” to file them together.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, padding: "0 15px 13px 61px", flexWrap: "wrap" }}>
          {batch.items.map((it) => (
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
          ))}
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
      )}
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
  onSkip,
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
  onSkip: () => void;
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

      {active ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
          title="Skip without filing"
          style={{ fontSize: 11, color: T.faint, cursor: "pointer", textAlign: "center" }}
        >
          Skip
        </span>
      ) : (
        <span style={{ color: T.dim, textAlign: "center" }}>·</span>
      )}
    </div>
  );
}

// Tracks whether the viewport is phone-width. Defaults to false so SSR matches
// the desktop layout; flips after mount via matchMedia (no hydration mismatch).
function useIsMobile(breakpoint = 900): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return mobile;
}

// ---- Mobile one-off card (replaces a Power-grid row on phones) --------------
function MobileTxnCard({
  txn,
  busy,
  onOpen,
  onAccept,
}: {
  txn: CockpitTxn;
  busy: boolean;
  onOpen: () => void;
  onAccept: () => void;
}) {
  const hasSug = !!txn.suggestedCategoryName;
  const tint =
    txn.confidence === "high"
      ? { bg: T.tintBg, border: T.tintBorder, text: T.accent }
      : txn.confidence === "medium"
        ? { bg: "#F5EEDA", border: T.amberBorder, text: T.amber }
        : { bg: "transparent", border: T.dim, text: T.faint };
  return (
    <div
      onClick={onOpen}
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        background: T.card,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "0 1px 2px rgba(28,26,23,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{txn.payee}</span>
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            color: txn.inflow ? T.accent : T.ink,
            whiteSpace: "nowrap",
          }}
        >
          {txn.amount}
        </span>
      </div>
      <div style={{ fontSize: 12, color: T.faint }}>
        {txn.date} · {txn.meta}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {hasSug ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAccept();
              }}
              disabled={busy}
              style={{
                flex: 1,
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 600,
                padding: "10px 12px",
                borderRadius: 9,
                border: `1px solid ${tint.border}`,
                background: tint.bg,
                color: tint.text,
                cursor: "pointer",
              }}
            >
              <span>{txn.suggestedCategoryName}</span>
              <span style={{ fontSize: 12 }}>File ✓</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              style={{
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 500,
                padding: "10px 14px",
                borderRadius: 9,
                border: `1px solid ${T.dim}`,
                background: "transparent",
                color: T.muted,
                cursor: "pointer",
              }}
            >
              Change
            </button>
          </>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            style={{
              flex: 1,
              textAlign: "left",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 500,
              padding: "10px 12px",
              borderRadius: 9,
              border: `1px dashed ${T.dim}`,
              background: "transparent",
              color: T.faint,
              cursor: "pointer",
            }}
          >
            <span>Choose category</span>
            <span>›</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Mobile category bottom sheet ------------------------------------------
function MobileCategorySheet({
  txn,
  query,
  options,
  canCreate,
  busy,
  onQuery,
  onPick,
  onCreate,
  onAccept,
  onSkip,
  onClose,
}: {
  txn: CockpitTxn;
  query: string;
  options: { id: string; name: string }[];
  canCreate: boolean;
  busy: boolean;
  onQuery: (v: string) => void;
  onPick: (c: { id: string; name: string }) => void;
  onCreate: () => void;
  onAccept: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const hasSug = !!txn.suggestedCategoryName;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,26,23,0.4)", zIndex: 55 }} />
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          background: T.card,
          borderRadius: "16px 16px 0 0",
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -12px 40px rgba(28,26,23,0.22)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <span style={{ width: 38, height: 4, borderRadius: 99, background: T.dim }} />
        </div>
        <div style={{ padding: "6px 18px 12px", borderBottom: `1px solid ${T.hair}` }}>
          <div style={{ ...uppercaseLabel, paddingBottom: 8 }}>File transaction</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{txn.payee}</span>
            <span
              style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: txn.inflow ? T.accent : T.ink }}
            >
              {txn.amount}
            </span>
          </div>
          <div style={{ fontSize: 12, color: T.faint, paddingTop: 2 }}>
            {txn.date} · {txn.meta}
          </div>
          {hasSug && (
            <button
              onClick={onAccept}
              disabled={busy}
              style={{
                marginTop: 12,
                width: "100%",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 600,
                padding: "11px 14px",
                borderRadius: 10,
                border: "none",
                background: T.accent,
                color: "#FAF9F6",
                cursor: "pointer",
              }}
            >
              Accept: {txn.suggestedCategoryName}
              {txn.reason ? ` · ${txn.reason}` : ""}
            </button>
          )}
        </div>
        <div style={{ padding: "12px 14px 8px" }}>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search categories…"
            style={{
              width: "100%",
              fontFamily: "inherit",
              fontSize: 15,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1.5px solid ${T.border}`,
              background: T.bg,
              color: T.ink,
              outline: "none",
            }}
          />
        </div>
        <div style={{ overflowY: "auto", padding: "0 8px 8px", flex: 1 }}>
          {options.map((c) => {
            const isSug = c.id === txn.suggestedCategoryId && !query.trim();
            return (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                disabled={busy}
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontFamily: "inherit",
                  fontSize: 15,
                  padding: "13px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: T.ink,
                  cursor: "pointer",
                  borderBottom: `1px solid ${T.hair}`,
                }}
              >
                <span>{highlightMatch(c.name, query)}</span>
                {isSug && <span style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>suggested</span>}
              </button>
            );
          })}
          {canCreate && (
            <button
              onClick={onCreate}
              disabled={busy}
              style={{
                width: "100%",
                textAlign: "left",
                fontFamily: "inherit",
                fontSize: 14,
                padding: "13px 12px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: T.accent,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + New category “{query.trim()}”
            </button>
          )}
          {options.length === 0 && !canCreate && (
            <div style={{ padding: "16px 12px", color: T.faint, fontSize: 13 }}>No matches</div>
          )}
        </div>
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.hair}`, display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 500,
              padding: "11px",
              borderRadius: 10,
              border: `1px solid ${T.dim}`,
              background: "transparent",
              color: T.muted,
              cursor: "pointer",
            }}
          >
            Done
          </button>
          <button
            onClick={onSkip}
            style={{
              flex: 1,
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 500,
              padding: "11px",
              borderRadius: 10,
              border: `1px solid ${T.dim}`,
              background: "transparent",
              color: T.muted,
              cursor: "pointer",
            }}
          >
            Skip →
          </button>
        </div>
      </div>
    </>
  );
}

// ---- Mobile bottom sheet for changing a Smart-batch's category ------------
function BatchCategorySheet({
  batch,
  query,
  options,
  canCreate,
  busy,
  onQuery,
  onPick,
  onCreate,
  onClose,
}: {
  batch: CockpitBatch;
  query: string;
  options: CockpitCategory[];
  canCreate: boolean;
  busy: boolean;
  onQuery: (v: string) => void;
  onPick: (c: CockpitCategory) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,26,23,0.4)", zIndex: 55 }} />
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          background: T.card,
          borderRadius: "16px 16px 0 0",
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -12px 40px rgba(28,26,23,0.22)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <span style={{ width: 38, height: 4, borderRadius: 99, background: T.dim }} />
        </div>
        <div style={{ padding: "6px 18px 12px", borderBottom: `1px solid ${T.hair}` }}>
          <div style={{ ...uppercaseLabel, paddingBottom: 8 }}>Change category</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {batch.title} <span style={{ fontWeight: 400, color: T.faint }}>× {batch.count}</span>
          </div>
          <div style={{ fontSize: 12, color: T.faint, paddingTop: 2 }}>File all under a different category</div>
        </div>
        <div style={{ padding: "12px 14px 8px" }}>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search categories…"
            style={{
              width: "100%",
              fontFamily: "inherit",
              fontSize: 15,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1.5px solid ${T.border}`,
              background: T.bg,
              color: T.ink,
              outline: "none",
            }}
          />
        </div>
        <div style={{ overflowY: "auto", padding: "0 8px 8px", flex: 1 }}>
          {options.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c)}
              disabled={busy}
              style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontFamily: "inherit",
                fontSize: 15,
                padding: "13px 12px",
                borderRadius: 8,
                border: "none",
                background: c.id === batch.suggestedCategoryId ? T.tintBg : "transparent",
                color: T.ink,
                cursor: "pointer",
                borderBottom: `1px solid ${T.hair}`,
              }}
            >
              <span>{highlightMatch(c.name, query)}</span>
              {c.id === batch.suggestedCategoryId && (
                <span style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>current</span>
              )}
            </button>
          ))}
          {canCreate && (
            <button
              onClick={onCreate}
              disabled={busy}
              style={{
                width: "100%",
                textAlign: "left",
                fontFamily: "inherit",
                fontSize: 14,
                padding: "13px 12px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: T.accent,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + New category “{query.trim()}”
            </button>
          )}
          {options.length === 0 && !canCreate && (
            <div style={{ padding: "16px 12px", color: T.faint, fontSize: 13 }}>No matches</div>
          )}
        </div>
      </div>
    </>
  );
}

// ---- Rule-suggestion editor (centered modal, desktop + mobile) -------------
type RuleDraft = {
  name: string;
  matchField: string;
  operator: string;
  value: string;
  categoryId: string;
};
function RuleEditor({
  draft,
  categories,
  busy,
  error,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: RuleDraft;
  categories: CockpitCategory[];
  busy: boolean;
  error: string | null;
  onChange: (d: RuleDraft) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const canSubmit = draft.name.trim().length > 0 && draft.value.trim().length > 0 && !!draft.categoryId && !busy;
  const fieldLabel: CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: T.faint,
    display: "block",
    paddingBottom: 5,
  };
  const inputStyle: CSSProperties = {
    width: "100%",
    fontFamily: "inherit",
    fontSize: 14,
    padding: "10px 12px",
    borderRadius: 9,
    border: `1.5px solid ${T.border}`,
    background: T.bg,
    color: T.ink,
    outline: "none",
  };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,26,23,0.4)", zIndex: 70 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 75,
          width: "min(420px, calc(100vw - 32px))",
          background: T.card,
          borderRadius: 12,
          border: `1px solid ${T.border}`,
          boxShadow: "0 24px 60px rgba(28,26,23,0.28)",
          padding: "20px 20px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: T.serif, fontSize: 20, letterSpacing: "-0.4px" }}>New rule</span>
          <span onClick={onClose} style={{ fontSize: 18, lineHeight: 1, color: T.faint, cursor: "pointer" }}>
            ×
          </span>
        </div>

        <div>
          <label style={fieldLabel}>Rule name</label>
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="Name this rule"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={fieldLabel}>When payee contains</label>
          <input
            value={draft.value}
            onChange={(e) => onChange({ ...draft, value: e.target.value })}
            placeholder="e.g. Corcoran Medical Plaza"
            style={inputStyle}
          />
          <div style={{ fontSize: 11.5, color: T.faint, paddingTop: 5 }}>Payee · contains</div>
        </div>

        <div>
          <label style={fieldLabel}>File under</label>
          <select
            value={draft.categoryId}
            onChange={(e) => onChange({ ...draft, categoryId: e.target.value })}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {!draft.categoryId && <option value="">Choose a category…</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {error && <div style={{ fontSize: 12.5, color: T.red }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 2 }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 500,
              padding: "9px 16px",
              borderRadius: 8,
              border: `1px solid ${T.dim}`,
              background: "transparent",
              color: T.muted,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              padding: "9px 16px",
              borderRadius: 8,
              border: "none",
              background: T.accent,
              color: "#FAF9F6",
              cursor: canSubmit ? "pointer" : "default",
              opacity: canSubmit ? 1 : 0.55,
            }}
          >
            Create rule
          </button>
        </div>
      </div>
    </>
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
