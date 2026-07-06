// CSV transaction import.
//   POST { accountId, csv } — parse a CSV whose header names the columns
//   date, description, amount (negative = outflow) and optional payee, then
//   insert each row as a Transaction (one split) on the chosen account. Rows are
//   run through the categorization rules, deduped best-effort, and recorded in a
//   single ImportBatch(source: "csv") for auditability.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";
import { toCents } from "@/lib/money";
import { categorize, type RuleLike } from "@/lib/categorize";
import { UNCATEGORIZED, TRANSFER_CATEGORY } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas /
 * newlines, and "" escaped quotes. Good enough for bank exports.
 */
function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function findColumn(header: string[], names: string[]): number {
  for (const name of names) {
    const exact = header.indexOf(name);
    if (exact >= 0) return exact;
  }
  // Fall back to a fuzzy "contains" match.
  for (const name of names) {
    const fuzzy = header.findIndex((h) => h.includes(name));
    if (fuzzy >= 0) return fuzzy;
  }
  return -1;
}

async function loadRules(businessId: string): Promise<RuleLike[]> {
  const rules = await prisma.rule.findMany({ where: { businessId, enabled: true } });
  return rules.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    priority: r.priority,
    matchField: r.matchField,
    operator: r.operator,
    value: r.value,
    categoryId: r.categoryId,
    markTransfer: r.markTransfer,
  }));
}

export async function POST(req: NextRequest) {
  const ctx = await requireBusinessContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const accountId = String(body.accountId ?? "");
  if (!accountId) return NextResponse.json({ error: "Pick an account to import into." }, { status: 400 });

  const account = await prisma.financialAccount.findFirst({ where: { id: accountId, businessId: ctx.businessId } });
  if (!account) return NextResponse.json({ error: "That account doesn't exist." }, { status: 404 });

  const csv = String(body.csv ?? "");
  const rows = parseCsv(csv).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (rows.length < 2) {
    return NextResponse.json(
      { error: "Add a header row plus at least one transaction row." },
      { status: 400 }
    );
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dateIdx = findColumn(header, ["date", "posted", "transaction date"]);
  const amountIdx = findColumn(header, ["amount", "value"]);
  const descIdx = findColumn(header, ["description", "desc", "memo", "details"]);
  const payeeIdx = findColumn(header, ["payee", "merchant", "name"]);

  if (dateIdx < 0 || amountIdx < 0) {
    return NextResponse.json(
      { error: "CSV needs at least a 'date' and an 'amount' column in the header row." },
      { status: 400 }
    );
  }

  const rules = await loadRules(ctx.businessId);
  const [uncategorized, transfer] = await Promise.all([
    prisma.category.findFirst({ where: { businessId: ctx.businessId, name: UNCATEGORIZED } }),
    prisma.category.findFirst({ where: { businessId: ctx.businessId, name: TRANSFER_CATEGORY } }),
  ]);
  const uncategorizedId = uncategorized?.id ?? null;
  const transferId = transfer?.id ?? null;

  const batch = await prisma.importBatch.create({
    data: { businessId: ctx.businessId, source: "csv", note: `${account.name} · CSV upload` },
  });

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawDate = (row[dateIdx] ?? "").trim();
    const rawAmount = (row[amountIdx] ?? "").trim();
    const description = descIdx >= 0 ? (row[descIdx] ?? "").trim() : "";
    const payee = (payeeIdx >= 0 ? (row[payeeIdx] ?? "").trim() : "") || description;

    if (!rawDate && !rawAmount) {
      skipped++;
      continue;
    }

    const postedAt = new Date(rawDate);
    if (isNaN(postedAt.getTime())) {
      skipped++;
      if (errors.length < 8) errors.push(`Row ${r + 1}: couldn't read the date "${rawDate}".`);
      continue;
    }

    const amountCents = toCents(rawAmount);
    if (!Number.isFinite(amountCents) || amountCents === 0) {
      skipped++;
      if (errors.length < 8) errors.push(`Row ${r + 1}: couldn't read the amount "${rawAmount}".`);
      continue;
    }

    // Best-effort dedupe: same account + date + amount + description.
    const dup = await prisma.transaction.findFirst({
      where: { businessId: ctx.businessId, accountId, postedAt, amountCents, description },
    });
    if (dup) {
      skipped++;
      continue;
    }

    const match = categorize(
      {
        payee: payee || description,
        description,
        amountCents,
        institution: account.institution,
        accountName: account.name,
      },
      rules
    );
    const categoryId = match
      ? match.markTransfer
        ? transferId ?? match.categoryId
        : match.categoryId
      : uncategorizedId;

    await prisma.transaction.create({
      data: {
        businessId: ctx.businessId,
        accountId,
        postedAt,
        amountCents,
        payee: payee || description,
        description,
        importBatchId: batch.id,
        splits: { create: [{ businessId: ctx.businessId, amountCents, categoryId }] },
      },
    });
    imported++;
  }

  await prisma.importBatch.update({
    where: { id: batch.id, businessId: ctx.businessId },
    data: { imported, skipped },
  });

  return NextResponse.json({ ok: true, imported, skipped, errors });
}
