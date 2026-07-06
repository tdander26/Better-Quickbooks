// CSV export endpoint. GET /api/export?type=pl|balance|cashflow|transactions&start&end
// Returns a downloadable CSV of the requested statement (or the raw transaction
// register) for the given date range. Amounts are plain decimal dollars so the
// file opens cleanly in spreadsheets; a UTF-8 BOM keeps Excel happy.
import { NextRequest, NextResponse } from "next/server";
import { parseISO, endOfDay, startOfYear, format } from "date-fns";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";
import { profitAndLoss, balanceSheet, cashFlow } from "@/lib/reports";
import { UNCATEGORIZED } from "@/lib/types";

export const runtime = "nodejs";

type ExportType = "pl" | "balance" | "cashflow" | "transactions";

/** Same range semantics as the reports page: default YTD, end-inclusive. */
function resolveRange(url: URL) {
  const now = new Date();
  let start = startOfYear(now);
  let end = now;
  const s = url.searchParams.get("start");
  const e = url.searchParams.get("end");
  if (s) {
    const p = parseISO(s);
    if (!isNaN(p.getTime())) start = p;
  }
  if (e) {
    const p = parseISO(e);
    if (!isNaN(p.getTime())) end = endOfDay(p);
  }
  return { start, end };
}

/** RFC-4180-ish escaping: quote a cell when it contains a comma, quote or newline. */
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Integer cents -> plain decimal dollars, e.g. -162000 -> "-1620.00". */
function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function GET(req: NextRequest) {
  const ctx = await requireBusinessContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type");
  const type: ExportType =
    typeParam === "balance" || typeParam === "cashflow" || typeParam === "transactions"
      ? typeParam
      : "pl";
  const { start, end } = resolveRange(url);

  const rows: (string | number)[][] = [];
  let name = "report";

  if (type === "pl") {
    const pl = await profitAndLoss(ctx.businessId, start, end);
    name = "profit-and-loss";
    rows.push(["Section", "Category", "Amount"]);
    for (const l of pl.income) rows.push(["Income", l.category, money(l.amountCents)]);
    rows.push(["Income", "Total income", money(pl.totalIncomeCents)]);
    for (const l of pl.expenses) rows.push(["Expense", l.category, money(l.amountCents)]);
    rows.push(["Expense", "Total expenses", money(pl.totalExpenseCents)]);
    rows.push(["Net", "Net income", money(pl.netIncomeCents)]);
  } else if (type === "cashflow") {
    const cf = await cashFlow(ctx.businessId, start, end);
    const totalIn = cf.inflows.reduce((n, l) => n + l.amountCents, 0);
    const totalOut = cf.outflows.reduce((n, l) => n + l.amountCents, 0);
    name = "cash-flow";
    rows.push(["Section", "Category", "Amount"]);
    for (const l of cf.inflows) rows.push(["Money In", l.category, money(l.amountCents)]);
    rows.push(["Money In", "Total in", money(totalIn)]);
    for (const l of cf.outflows) rows.push(["Money Out", l.category, money(l.amountCents)]);
    rows.push(["Money Out", "Total out", money(totalOut)]);
    rows.push(["Net", "Net change", money(cf.netCents)]);
  } else if (type === "balance") {
    const bs = await balanceSheet(ctx.businessId);
    name = "balance-sheet";
    rows.push(["Section", "Account", "Institution", "Amount"]);
    for (const a of bs.assets) rows.push(["Asset", a.name, a.institution, money(a.computedCents)]);
    rows.push(["Asset", "Total assets", "", money(bs.totalAssetsCents)]);
    // Liabilities are stored negative; export the positive amount owed.
    for (const a of bs.liabilities) rows.push(["Liability", a.name, a.institution, money(-a.computedCents)]);
    rows.push(["Liability", "Total liabilities", "", money(bs.totalLiabilitiesCents)]);
    rows.push(["Equity", "Owner's equity", "", money(bs.equityCents)]);
  } else {
    // transactions — the full register for the range (one row per transaction).
    const txns = await prisma.transaction.findMany({
      where: { businessId: ctx.businessId, postedAt: { gte: start, lte: end }, account: { archived: false } },
      orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }],
      include: { account: true, splits: { include: { category: true } } },
    });
    name = "transactions";
    rows.push(["Date", "Account", "Payee", "Description", "Category", "Amount"]);
    for (const t of txns) {
      const category =
        t.splits.length > 1 ? "Split" : t.splits[0]?.category?.name ?? UNCATEGORIZED;
      rows.push([
        format(t.postedAt, "yyyy-MM-dd"),
        t.account.name,
        t.payee || "",
        t.description || "",
        category,
        money(t.amountCents),
      ]);
    }
  }

  const csv = "﻿" + toCsv(rows); // UTF-8 BOM so Excel detects encoding
  const stamp = `${format(start, "yyyy-MM-dd")}_to_${format(end, "yyyy-MM-dd")}`;
  const filename = `better-books_${name}_${stamp}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
