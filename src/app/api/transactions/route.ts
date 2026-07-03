// Transactions collection endpoint.
//   GET  — filtered/paginated list (optional convenience API; same filters as the page)
//   POST — manual transaction entry: creates a transaction with a single split
//          (chosen category or Uncategorized). Dollar input -> integer cents.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { toCents } from "@/lib/money";
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

  const accountId = String(body.accountId ?? "");
  if (!accountId) {
    return NextResponse.json({ error: "Pick an account" }, { status: 400 });
  }
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) {
    return NextResponse.json({ error: "That account doesn't exist" }, { status: 404 });
  }

  const payee = String(body.payee ?? "").trim();
  if (!payee) {
    return NextResponse.json({ error: "Add a payee or description" }, { status: 400 });
  }
  const description = String(body.description ?? "").trim();

  // Signed dollars -> integer cents (positive = money in, negative = money out).
  const amountCents = toCents(body.amount ?? 0);
  if (!Number.isFinite(amountCents) || amountCents === 0) {
    return NextResponse.json({ error: "Enter an amount" }, { status: 400 });
  }

  let postedAt = new Date();
  if (body.postedAt) {
    const parsed = new Date(String(body.postedAt));
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That date isn't valid" }, { status: 400 });
    }
    postedAt = parsed;
  }

  // Resolve category: explicit choice, else fall back to Uncategorized.
  const uncategorized = await prisma.category.findFirst({ where: { name: UNCATEGORIZED } });
  const requestedCategoryId = body.categoryId ? String(body.categoryId) : "";
  let categoryId: string | null = uncategorized?.id ?? null;
  if (requestedCategoryId) {
    const cat = await prisma.category.findUnique({ where: { id: requestedCategoryId } });
    if (!cat) return NextResponse.json({ error: "That category doesn't exist" }, { status: 400 });
    categoryId = cat.id;
  }

  // Choosing a real (non-Uncategorized) category counts as reviewed.
  const reviewed = Boolean(requestedCategoryId && requestedCategoryId !== uncategorized?.id);

  const transaction = await prisma.transaction.create({
    data: {
      accountId,
      postedAt,
      amountCents,
      payee,
      description,
      reviewed,
      splits: { create: [{ amountCents, categoryId }] },
    },
    include: { account: true, splits: { include: { category: true } } },
  });

  return NextResponse.json({ ok: true, transaction }, { status: 201 });
}
