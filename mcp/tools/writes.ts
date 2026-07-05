// Write MCP tools: manual transaction entry, categorization, rule creation,
// reapply-rules, and the SimpleFIN feed refresh. Each delegates to the shared
// src/lib helpers so behavior matches the web app exactly.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import {
  createManualTransaction,
  setTransactionCategory,
  TransactionInputError,
} from "@/lib/transactions";
import { reapplyRules } from "@/lib/sync";
import { refreshFeeds, FeedRefreshError } from "@/lib/feeds/refresh";
import { MATCH_FIELDS, OPERATORS } from "@/lib/types";
import { ok, err, money } from "../format.js";

export function registerWriteTools(server: McpServer) {
  server.registerTool(
    "create_transaction",
    {
      description:
        "Manually add a transaction to an account. Amount is signed dollars (positive = money in, negative = money out). Falls back to Uncategorized when no category is given.",
      inputSchema: {
        accountId: z.string().describe("Account id (see list_accounts)"),
        amount: z
          .union([z.number(), z.string()])
          .describe("Signed dollar amount, e.g. -42.50 for a $42.50 expense"),
        payee: z.string().describe("Payee / counterparty"),
        description: z.string().optional(),
        postedAt: z.string().optional().describe("ISO date (default: now)"),
        categoryId: z.string().optional().describe("Category id (see list_categories)"),
      },
    },
    async (args) => {
      try {
        const t = await createManualTransaction(args);
        return ok({
          ok: true,
          id: t.id,
          account: t.account.name,
          payee: t.payee,
          amount: money(t.amountCents),
          reviewed: t.reviewed,
          splits: t.splits.map((s) => ({
            category: s.category?.name ?? "Uncategorized",
            amount: money(s.amountCents),
          })),
        });
      } catch (e) {
        if (e instanceof TransactionInputError) return err(e.message);
        throw e;
      }
    }
  );

  server.registerTool(
    "categorize_transaction",
    {
      description:
        "Assign a category to a transaction (collapses it to a single split) and mark it reviewed. Pass categoryId=null to reset to Uncategorized.",
      inputSchema: {
        id: z.string().describe("Transaction id"),
        categoryId: z
          .string()
          .nullable()
          .describe("Category id, or null for Uncategorized"),
      },
    },
    async ({ id, categoryId }) => {
      try {
        const t = await setTransactionCategory(id, categoryId ?? null);
        return ok({
          ok: true,
          id: t?.id,
          reviewed: t?.reviewed,
          splits: t?.splits.map((s) => ({
            category: s.category?.name ?? "Uncategorized",
            amount: money(s.amountCents),
          })),
        });
      } catch (e) {
        if (e instanceof TransactionInputError) return err(e.message);
        throw e;
      }
    }
  );

  server.registerTool(
    "create_rule",
    {
      description:
        "Create an auto-categorization rule. On import (and on reapply_rules), transactions are matched against enabled rules by ascending priority; the first match assigns the category.",
      inputSchema: {
        name: z.string().describe("Human-readable rule name"),
        matchField: z.enum(MATCH_FIELDS).describe("Which field to match on"),
        operator: z.enum(OPERATORS).describe("Comparison operator"),
        value: z.string().describe("Value to match (for amount ops, a dollar figure)"),
        categoryId: z.string().describe("Category to assign on match"),
        priority: z.number().int().optional().describe("Lower runs first (default 100)"),
        enabled: z.boolean().optional().describe("Default true"),
        markTransfer: z
          .boolean()
          .optional()
          .describe("If true, matched txns are flagged as internal transfers"),
      },
    },
    async ({ name, matchField, operator, value, categoryId, priority, enabled, markTransfer }) => {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!cat) return err(`No category with id ${categoryId}`);

      const rule = await prisma.rule.create({
        data: {
          name,
          matchField,
          operator,
          value,
          categoryId,
          priority: priority ?? 100,
          enabled: enabled ?? true,
          markTransfer: markTransfer ?? false,
        },
      });
      return ok({ ok: true, rule: { id: rule.id, name: rule.name, priority: rule.priority } });
    }
  );

  server.registerTool(
    "reapply_rules",
    {
      description:
        "Re-run the rules engine across transactions that are still Uncategorized and not yet reviewed. Never overwrites a category you've confirmed. Returns how many were updated.",
      inputSchema: {},
    },
    async () => {
      const { updated } = await reapplyRules();
      return ok({ ok: true, updated });
    }
  );

  server.registerTool(
    "refresh_feed",
    {
      description:
        "Pull new transactions from the connected SimpleFIN bank feed, dedupe, and auto-categorize them. Requires a connection and the ENCRYPTION_KEY env var. Returns imported/skipped counts.",
      inputSchema: {},
    },
    async () => {
      try {
        const summary = await refreshFeeds();
        return ok({
          ok: true,
          imported: summary.imported,
          skipped: summary.skipped,
          accountsSeen: summary.accountsSeen,
          errors: summary.errors,
        });
      } catch (e) {
        if (e instanceof FeedRefreshError) return err(e.message);
        const msg = e instanceof Error ? e.message : "Refresh failed.";
        return err(msg);
      }
    }
  );
}
