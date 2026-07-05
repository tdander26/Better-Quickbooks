// Shared helpers for shaping MCP tool output. Results are returned as JSON text;
// money is emitted as both raw integer cents and a human-readable string (Claude
// reads the string, keeps the number for arithmetic). Dates -> ISO strings.

import { formatMoney } from "@/lib/money";
import {
  startOfMonth,
  endOfMonth,
  parseISO,
  isValid,
} from "date-fns";

/** A successful tool result carrying a JSON payload as text. */
export function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, jsonReplacer, 2) }],
  };
}

/** An error tool result with a clear message (never throws raw to the client). */
export function err(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

/** JSON.stringify replacer: Date -> ISO, BigInt -> Number. */
function jsonReplacer(_key: string, value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  return value;
}

/** Attach a formatted dollar string next to a cents figure. */
export function money(cents: number) {
  return { cents, formatted: formatMoney(cents) };
}

/**
 * Resolve a {start,end} date range from optional ISO strings, defaulting to the
 * current calendar month. Throws on an unparseable date.
 */
export function resolveRange(startISO?: string, endISO?: string): { start: Date; end: Date } {
  const now = new Date();
  let start = startOfMonth(now);
  let end = endOfMonth(now);

  if (startISO) {
    const d = parseISO(startISO);
    if (!isValid(d)) throw new Error(`Invalid start date: ${startISO}`);
    start = d;
  }
  if (endISO) {
    const d = parseISO(endISO);
    if (!isValid(d)) throw new Error(`Invalid end date: ${endISO}`);
    end = d;
    end.setHours(23, 59, 59, 999);
  }
  return { start, end };
}
