// Transactions — the core workspace. A Server Component: it parses the URL
// filters, builds the prisma where-clause, and fetches the page of transactions
// (plus every account & category for the dropdowns), then hands it all to the
// interactive register in _table.tsx.
import { prisma } from "@/lib/db";
import { UNCATEGORIZED } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import type { Prisma } from "@prisma/client";
import {
  TransactionsTable,
  type TxnRow,
  type CategoryOption,
  type AccountOption,
  type TxnFilters,
} from "./_table";

// Financial data is per-request; never statically cache.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;

  const q = (sp.q ?? "").trim();
  const account = sp.account ?? "";
  const category = sp.category ?? "";
  const filter = sp.filter ?? "all";
  const startStr = sp.start ?? "";
  const endStr = sp.end ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const start = parseDate(startStr);
  const end = parseDate(endStr);

  // --- Build the where-clause from active filters --------------------------
  const and: Prisma.TransactionWhereInput[] = [];

  if (q) {
    and.push({
      OR: [
        { payee: { contains: q } },
        { description: { contains: q } },
        { memo: { contains: q } },
      ],
    });
  }
  if (account) and.push({ accountId: account });
  if (category) and.push({ splits: { some: { categoryId: category } } });

  const uncategorizedSplit: Prisma.SplitWhereInput = {
    OR: [{ categoryId: null }, { category: { is: { name: UNCATEGORIZED } } }],
  };
  if (filter === "uncategorized") {
    and.push({ splits: { some: uncategorizedSplit, every: uncategorizedSplit } });
  } else if (filter === "pending") {
    and.push({ pending: true });
  } else if (filter === "reviewed") {
    and.push({ reviewed: true });
  } else if (filter === "needs_review") {
    and.push({ reviewed: false });
  }

  if (start || end) {
    const postedAt: Prisma.DateTimeFilter = {};
    if (start) postedAt.gte = start;
    if (end) {
      const e = new Date(end);
      e.setHours(23, 59, 59, 999); // include the whole end day
      postedAt.lte = e;
    }
    and.push({ postedAt });
  }

  const where: Prisma.TransactionWhereInput = and.length ? { AND: and } : {};

  // --- Fetch the page + option lists ---------------------------------------
  const [total, txns, accounts, categories] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
      include: { account: true, splits: { include: { category: true } } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.account.findMany({
      where: { archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.category.findMany({ orderBy: [{ section: "asc" }, { name: "asc" }] }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Serialize into plain, client-safe shapes.
  const rows: TxnRow[] = txns.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    accountName: t.account.name,
    postedAt: t.postedAt.toISOString(),
    amountCents: t.amountCents,
    payee: t.payee,
    description: t.description,
    memo: t.memo,
    notes: t.notes,
    pending: t.pending,
    reviewed: t.reviewed,
    transferId: t.transferId,
    splits: t.splits.map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      amountCents: s.amountCents,
      memo: s.memo,
    })),
  }));

  const categoryOptions: CategoryOption[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    section: c.section,
    color: c.color,
  }));
  const accountOptions: AccountOption[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    institution: a.institution,
  }));

  const filters: TxnFilters = { q, account, category, filter, start: startStr, end: endStr };

  const subtitle =
    total === 0
      ? "Your register — search, categorize, split and reconcile"
      : `${total.toLocaleString()} ${total === 1 ? "transaction" : "transactions"}`;

  return (
    <div>
      <PageHeader title="Transactions" subtitle={subtitle} />
      <TransactionsTable
        transactions={rows}
        accounts={accountOptions}
        categories={categoryOptions}
        filters={filters}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        totalPages={totalPages}
      />
    </div>
  );
}
