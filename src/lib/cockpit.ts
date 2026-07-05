// Data layer for the Categorize Cockpit (src/app/categorize).
//
// Assembles everything the three-pane cockpit renders, from REAL data:
//   - left rail accounts + running balances
//   - the unreviewed-transaction queue, grouped into Smart batches (same merchant
//     + shared suggestion) and one-offs (the Power grid)
//   - a suggested category + confidence per transaction, from the rules engine
//     first, then from how the same payee has been filed before
//   - recent activity, "needs attention" items, and a computed quarterly tax estimate
//
// Pure-ish: one exported async function does all the reads and returns a plain,
// serializable object for the client component.
import { startOfQuarter, startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { categorize, type RuleLike } from "@/lib/categorize";
import { formatMoney } from "@/lib/money";
import { UNCATEGORIZED, TRANSFER_CATEGORY } from "@/lib/types";

// Merchant avatar palettes, cycled per batch (blue / sand / plum, per spec).
const AVATARS = [
  { bg: "#E3E9F2", color: "#3D5A85", dot: "#3D5A85" },
  { bg: "#E9E2D4", color: "#6E695D", dot: "#B98A47" },
  { bg: "#EDE4EE", color: "#6E4A73", dot: "#8A6BA0" },
  { bg: "#E4EEE8", color: "#21543E", dot: "#2A6B4F" },
];

const MIN_BATCH = 2; // ≥ this many same-merchant txns forms a batch

export type Confidence = "high" | "medium" | "none";

export interface CockpitCategory {
  id: string;
  name: string;
  section: string;
}

export interface CockpitAccount {
  id: string;
  name: string;
  detail: string;
  balance: string;
  negative: boolean;
}

export interface CockpitTxn {
  id: string;
  date: string; // "Jul 2"
  payee: string;
  meta: string; // account + memo line
  amount: string; // signed, e.g. "−312.19"
  inflow: boolean;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  confidence: Confidence;
  reason: string | null;
}

export interface CockpitBatchItem {
  id: string;
  label: string; // "Jun 8 · +2,206"
}

export interface CockpitBatch {
  key: string;
  initials: string;
  title: string;
  count: number;
  sub: string;
  total: string;
  totalInflow: boolean;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  catDot: string;
  avatarBg: string;
  avatarColor: string;
  cta: string;
  txnIds: string[];
  items: CockpitBatchItem[]; // collapsed preview (first few)
  members: CockpitTxn[]; // every txn in the batch (for expand / flag pull-out)
  flag: { id: string; text: string } | null;
}

export interface CockpitActivity {
  id: string;
  name: string;
  meta: string;
  amount: string;
  tone: "accent" | "ink" | "muted";
}

export interface CockpitAttention {
  id: string;
  title: string;
  tag: string;
  tagTone: "red" | "accent" | "neutral";
  detail: string;
}

export interface CockpitTax {
  label: string;
  due: string;
  amount: string;
}

export interface CockpitData {
  accounts: CockpitAccount[];
  categories: CockpitCategory[];
  uncategorizedId: string | null;
  batches: CockpitBatch[];
  oneOffs: CockpitTxn[];
  recent: CockpitActivity[];
  attention: CockpitAttention[];
  tax: CockpitTax;
  remaining: number;
  grouped: number; // # of txns tied up in batches
  navBadge: number; // uncategorized count for the nav
}

const monthAbbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(d: Date): string {
  return `${monthAbbr[d.getMonth()]} ${d.getDate()}`;
}
function relativeDate(d: Date, now: Date): string {
  const day = startOfDay(d).getTime();
  const today = startOfDay(now).getTime();
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return shortDate(d);
}
// Signed, no currency symbol, thousands-separated: 220600 -> "+2,206.00".
function signedPlain(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const num = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "−" : "+"}${num}`;
}
function initialsOf(payee: string): string {
  const words = payee.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function accountDetail(institution: string, type: string): string {
  const kind = type === "credit_card" ? "Card" : type === "bank" ? "Checking" : "Account";
  return `${institution} · ${kind}`;
}

export async function getCockpitData(): Promise<CockpitData> {
  const now = new Date();

  const [accountBalancesRows, rulesRaw, categoriesRaw, unreviewed, reviewed] = await Promise.all([
    // Running balances (opening + sum of txns), mirroring reports.accountBalances.
    (async () => {
      const accounts = await prisma.account.findMany({
        where: { archived: false },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const sums = await prisma.transaction.groupBy({ by: ["accountId"], _sum: { amountCents: true } });
      const byAcct = new Map(sums.map((s) => [s.accountId, s._sum.amountCents ?? 0]));
      return accounts.map((a) => ({
        id: a.id,
        name: a.name,
        institution: a.institution,
        type: a.type,
        balanceCents: a.openingBalanceCents + (byAcct.get(a.id) ?? 0),
      }));
    })(),
    prisma.rule.findMany({ orderBy: [{ priority: "asc" }] }),
    prisma.category.findMany({ orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
    prisma.transaction.findMany({
      where: { reviewed: false },
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
      include: { account: true, splits: { include: { category: true } } },
    }),
    prisma.transaction.findMany({
      where: { reviewed: true },
      orderBy: [{ postedAt: "desc" }, { updatedAt: "desc" }],
      include: { account: true, splits: { include: { category: true } } },
      take: 400,
    }),
  ]);

  const catById = new Map(categoriesRaw.map((c) => [c.id, c]));
  const uncategorized = categoriesRaw.find((c) => c.name === UNCATEGORIZED) ?? null;

  // Categories offered in the type-ahead picker: everything real the user can
  // file under (exclude the "unfiled" Uncategorized bucket itself).
  const categories: CockpitCategory[] = categoriesRaw
    .filter((c) => c.name !== UNCATEGORIZED)
    .map((c) => ({ id: c.id, name: c.name, section: c.section }));

  // History: how has each payee been filed before? payee -> categoryId -> count.
  const history = new Map<string, Map<string, number>>();
  for (const t of reviewed) {
    const cat = t.splits[0]?.category;
    if (!cat || cat.name === UNCATEGORIZED || cat.name === TRANSFER_CATEGORY) continue;
    const key = t.payee.trim().toLowerCase();
    if (!key) continue;
    const inner = history.get(key) ?? new Map<string, number>();
    inner.set(cat.id, (inner.get(cat.id) ?? 0) + 1);
    history.set(key, inner);
  }
  function topHistory(payee: string): { categoryId: string; count: number } | null {
    const inner = history.get(payee.trim().toLowerCase());
    if (!inner) return null;
    let best: { categoryId: string; count: number } | null = null;
    for (const [categoryId, count] of inner) {
      if (!best || count > best.count) best = { categoryId, count };
    }
    return best;
  }

  const rules: RuleLike[] = rulesRaw.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    priority: r.priority,
    matchField: r.matchField,
    operator: r.operator,
    value: r.value,
    categoryId: r.categoryId,
    markTransfer: r.markTransfer,
  }));

  // Suggest a category + confidence for one unreviewed transaction.
  function suggest(t: (typeof unreviewed)[number]): {
    categoryId: string | null;
    name: string | null;
    confidence: Confidence;
    reason: string | null;
  } {
    // 1) Rules engine (skip transfer-flagging rules — those aren't a P&L category).
    const ruleHit = categorize(
      {
        payee: t.payee,
        description: t.description,
        amountCents: t.amountCents,
        institution: t.account.institution,
        accountName: t.account.name,
      },
      rules,
    );
    if (ruleHit && !ruleHit.markTransfer) {
      const cat = catById.get(ruleHit.categoryId);
      if (cat && cat.name !== UNCATEGORIZED) {
        return { categoryId: cat.id, name: cat.name, confidence: "high", reason: "matches your rules" };
      }
    }
    // 2) How this payee was filed before.
    const hist = topHistory(t.payee);
    if (hist) {
      const cat = catById.get(hist.categoryId);
      if (cat) {
        const confidence: Confidence = hist.count >= 3 ? "high" : "medium";
        const reason = hist.count >= 3 ? `filed here ${hist.count} times` : `filed here ${hist.count}×`;
        return { categoryId: cat.id, name: cat.name, confidence, reason };
      }
    }
    return { categoryId: null, name: null, confidence: "none", reason: null };
  }

  const enriched = unreviewed.map((t) => {
    const s = suggest(t);
    return {
      raw: t,
      txn: {
        id: t.id,
        date: shortDate(t.postedAt),
        payee: t.payee || t.description || "—",
        meta: `${accountDetail(t.account.institution, t.account.type)}${t.pending ? " · pending" : ""}`,
        amount: signedPlain(t.amountCents),
        inflow: t.amountCents > 0,
        suggestedCategoryId: s.categoryId,
        suggestedCategoryName: s.name,
        confidence: s.confidence,
        reason: s.reason,
      } satisfies CockpitTxn,
      suggestedCategoryId: s.categoryId,
    };
  });

  // ---- Smart batches: group by payee; batch when ≥ MIN_BATCH share a suggestion ----
  const byPayee = new Map<string, typeof enriched>();
  for (const e of enriched) {
    const key = e.raw.payee.trim().toLowerCase() || e.raw.id;
    const arr = byPayee.get(key) ?? [];
    arr.push(e);
    byPayee.set(key, arr);
  }

  const batches: CockpitBatch[] = [];
  const batchedIds = new Set<string>();
  let avatarIdx = 0;

  for (const group of byPayee.values()) {
    if (group.length < MIN_BATCH) continue;

    // The category the group agrees on (most common non-null suggestion).
    const votes = new Map<string, number>();
    for (const e of group) {
      if (e.suggestedCategoryId) votes.set(e.suggestedCategoryId, (votes.get(e.suggestedCategoryId) ?? 0) + 1);
    }
    let winner: string | null = null;
    let winnerVotes = 0;
    for (const [id, n] of votes) if (n > winnerVotes) ((winner = id), (winnerVotes = n));
    if (!winner) continue; // no shared suggestion -> leave as one-offs

    const cat = catById.get(winner);
    if (!cat) continue;

    const palette = AVATARS[avatarIdx % AVATARS.length];
    avatarIdx++;

    const sorted = [...group].sort((a, b) => b.raw.postedAt.getTime() - a.raw.postedAt.getTime());
    const total = sorted.reduce((n, e) => n + e.raw.amountCents, 0);
    const inflowMajority = sorted.filter((e) => e.raw.amountCents > 0).length > sorted.length / 2;

    const items: CockpitBatchItem[] = sorted
      .slice(0, 3)
      .map((e) => ({ id: e.raw.id, label: `${shortDate(e.raw.postedAt)} · ${signedPlain(e.raw.amountCents)}` }));
    if (sorted.length > 3) items.push({ id: "more", label: `+ ${sorted.length - 3} more` });

    // Flag an odd one out: an entry whose sign differs from the group majority.
    let flag: CockpitBatch["flag"] = null;
    const oddOne = sorted.find((e) => e.raw.amountCents > 0 !== inflowMajority);
    if (oddOne) {
      flag = { id: oddOne.raw.id, text: `${shortDate(oddOne.raw.postedAt)} entry looks different — review?` };
    }

    const reasonBits = topHistory(group[0].raw.payee);
    const sub = inflowMajority
      ? `Deposits → ${cat.name}`
      : `→ ${cat.name}${reasonBits && reasonBits.count >= 3 ? ` · filed here ${reasonBits.count} times` : ""}`;

    for (const e of sorted) batchedIds.add(e.raw.id);

    batches.push({
      key: group[0].raw.id,
      initials: initialsOf(group[0].raw.payee),
      title: group[0].raw.payee || group[0].raw.description || "—",
      count: sorted.length,
      sub,
      total: `${total < 0 ? "−" : "+"}${formatMoney(Math.abs(total))}`,
      totalInflow: total >= 0,
      suggestedCategoryId: cat.id,
      suggestedCategoryName: cat.name,
      catDot: inflowMajority ? "#2A6B4F" : palette.dot,
      avatarBg: palette.bg,
      avatarColor: palette.color,
      cta: `File all ${sorted.length}`,
      txnIds: sorted.map((e) => e.raw.id),
      items,
      members: sorted.map((e) => e.txn),
      flag,
    });
  }

  batches.sort((a, b) => b.count - a.count);

  const oneOffs = enriched.filter((e) => !batchedIds.has(e.raw.id)).map((e) => e.txn);

  // ---- Recent activity: latest reviewed transactions ----
  const recent: CockpitActivity[] = reviewed.slice(0, 6).map((t) => {
    const cat = t.splits[0]?.category;
    const isTransfer = cat?.name === TRANSFER_CATEGORY;
    const inflow = t.amountCents > 0;
    const rel = relativeDate(t.postedAt, now);
    let meta: string;
    let tone: CockpitActivity["tone"];
    if (isTransfer) {
      meta = `Transfer · ${rel}`;
      tone = "muted";
    } else if (inflow) {
      meta = `${cat?.name ?? "Deposit"} · ${rel}`;
      tone = "accent";
    } else {
      meta = `Filed → ${cat?.name ?? "Uncategorized"} · ${rel}`;
      tone = "ink";
    }
    return {
      id: t.id,
      name: t.payee || t.description || "—",
      meta,
      amount: formatMoney(t.amountCents, { signed: true }),
      tone,
    };
  });

  // ---- Needs attention ----
  const attention: CockpitAttention[] = [];
  const remaining = unreviewed.length;

  // Large unreviewed EXPENSE (red) — an outflow ≥ $1,000 still to categorize.
  const largestExpense = unreviewed
    .filter((t) => t.amountCents < 0)
    .sort((a, b) => a.amountCents - b.amountCents)[0];
  if (largestExpense && Math.abs(largestExpense.amountCents) >= 100_000) {
    attention.push({
      id: `large-${largestExpense.id}`,
      title: "Large expense to review",
      tag: formatMoney(largestExpense.amountCents),
      tagTone: "red",
      detail: `${largestExpense.payee || largestExpense.description} · not yet categorized`,
    });
  }

  // Everything still to categorize (accent).
  if (remaining > 0) {
    const acctCount = new Set(unreviewed.map((t) => t.accountId)).size;
    attention.push({
      id: "remaining",
      title: `${remaining} to categorize`,
      tag: "Inbox",
      tagTone: "accent",
      detail: `${batches.length} smart ${batches.length === 1 ? "batch" : "batches"} · across ${acctCount} ${acctCount === 1 ? "account" : "accounts"}`,
    });
  }

  // A rule you could create (new): a payee consistently filed the same way, with
  // no rule matching it yet.
  let ruleSuggestion: { payee: string; catName: string; count: number } | null = null;
  for (const [payeeKey, inner] of history) {
    let catId: string | null = null;
    let count = 0;
    for (const [cid, n] of inner) if (n > count) ((catId = cid), (count = n));
    if (count < 3 || !catId) continue;
    const cat = catById.get(catId);
    if (!cat) continue;
    // Does an enabled rule already resolve this payee to a category?
    const covered = rules.some(
      (r) =>
        r.enabled &&
        (r.matchField === "payee" || r.matchField === "description") &&
        payeeKey.includes(r.value.toLowerCase()),
    );
    if (covered) continue;
    if (!ruleSuggestion || count > ruleSuggestion.count) {
      ruleSuggestion = { payee: history.has(payeeKey) ? payeeKey : payeeKey, catName: cat.name, count };
    }
  }
  if (ruleSuggestion) {
    // Title-case the payee key for display.
    const pretty = ruleSuggestion.payee.replace(/\b\w/g, (m) => m.toUpperCase());
    attention.push({
      id: "rule-suggestion",
      title: "1 rule suggestion",
      tag: "New",
      tagTone: "neutral",
      detail: `Always file “${pretty}” under ${ruleSuggestion.catName}?`,
    });
  }

  // ---- Quarterly estimated tax (25% of this quarter's net profit) ----
  const qStart = startOfQuarter(now);
  const pnlSplits = await prisma.split.findMany({
    where: {
      category: { section: { in: ["income", "expense"] } },
      transaction: { postedAt: { gte: qStart, lte: now } },
    },
    select: { amountCents: true },
  });
  const netCents = pnlSplits.reduce((n, s) => n + s.amountCents, 0);
  const estCents = Math.max(0, Math.round(netCents * 0.25));
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const dueByQuarter: Record<number, string> = { 1: "Apr 15", 2: "Jun 15", 3: "Sep 15", 4: "Jan 15" };

  const tax: CockpitTax = {
    label: `Q${quarter} estimated tax`,
    due: `due ${dueByQuarter[quarter]}`,
    amount: formatMoney(estCents, { showCents: false }),
  };

  // ---- Left-rail accounts ----
  const accounts: CockpitAccount[] = accountBalancesRows.map((a) => ({
    id: a.id,
    name: a.name,
    detail: accountDetail(a.institution, a.type),
    // Magnitude only; the left rail prepends the "−" for negatives itself.
    balance: formatMoney(Math.abs(a.balanceCents), { showCents: false }),
    negative: a.balanceCents < 0,
  }));

  return {
    accounts,
    categories,
    uncategorizedId: uncategorized?.id ?? null,
    batches,
    oneOffs,
    recent,
    attention,
    tax,
    remaining,
    grouped: batchedIds.size,
    navBadge: remaining,
  };
}
