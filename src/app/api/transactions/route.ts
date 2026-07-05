// Transactions collection endpoint.
//   GET  — filtered/paginated list (optional convenience API; same filters as the page)
//   POST — manual transaction entry: creates a transaction with a single split
//          (chosen category or Uncategorized). Dollar input -> integer cents.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { createManualTransaction, TransactionInputError } from "@/lib/transactions";
import { UNCATEGORIZED } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Shared where-clause builder so GET mirrors the page's filtering exactly. */
function buildWhere(params: URLSearchParams): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [];

  const q = (params.get("q") ?? "").trim();
  if (q) {
    and.push({
      OR: [
        { payee: { contains: q } },
        { description: { contains: q } },
        { memo: { contains: q } },
      ],
    });
  }

  const account = params.get("account");
  if (account) and.push({ accountId: account });

  const category = params.get("category");
  if (category) and.push({ splits: { some: { categoryId: category } } });

  const uncategorizedSplit: Prisma.SplitWhereInput = {
    OR: [{ categoryId: null }, { category: { is: { name: UNCATEGORIZED } } }],
  };
  const filter = params.get("filter") ?? "all";
  if (filter === "uncategorized") {
    and.push({ splits: { some: uncategorizedSplit, every: uncategorizedSplit } });
  } else if (filter === "pending") {
    and.push({ pending: true });
  } else if (filter === "reviewed") {
    and.push({ reviewed: true });
  } else if (filter === "needs_review") {
    and.push({ reviewed: false });
  }

  const start = parseDate(params.get("start"));
  const end = parseDate(params.get("end"));
  if (start || end) {
    let endOfDay: Date | null = null;
    if (end) {
      endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 999);
    }
    and.push({
      postedAt: {
        ...(start ? { gte: start } : {}),
        ...(endOfDay ? { lte: endOfDay } : {}),
      },
    });
  }

  return and.length ? { AND: and } : {};
}

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const where = buildWhere(params);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
      include: { account: true, splits: { include: { category: true } } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return NextResponse.json({
    transactions,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const transaction = await createManualTransaction({
      accountId: body.accountId,
      amount: body.amount,
      payee: body.payee,
      description: body.description,
      postedAt: body.postedAt,
      categoryId: body.categoryId,
    });
    return NextResponse.json({ ok: true, transaction }, { status: 201 });
  } catch (e) {
    if (e instanceof TransactionInputError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
