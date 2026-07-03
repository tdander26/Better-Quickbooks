import { describe, it, expect } from "vitest";
import { toCents, toDollars, formatMoney, formatMoneyCompact } from "./money";

describe("toCents", () => {
  it("handles numbers and rounds", () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30); // no float drift in the stored value
  });
  it("parses currency strings with symbols/commas/negatives", () => {
    expect(toCents("$1,620.00")).toBe(162000);
    expect(toCents("-1,620.00")).toBe(-162000);
    expect(toCents("  42 ")).toBe(4200);
  });
  it("bad input -> 0", () => {
    expect(toCents("abc")).toBe(0);
  });
});

describe("toDollars", () => {
  it("inverts toCents", () => {
    expect(toDollars(162000)).toBe(1620);
  });
});

describe("formatMoney", () => {
  it("formats USD with sign", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-500)).toBe("-$5.00");
    expect(formatMoney(500, { signed: true })).toBe("+$5.00");
  });
  it("can hide cents", () => {
    expect(formatMoney(123456, { showCents: false })).toBe("$1,235");
  });
});

describe("formatMoneyCompact", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatMoneyCompact(1234567)).toBe("$12.3k");
    expect(formatMoneyCompact(123456789)).toBe("$1.2M");
    expect(formatMoneyCompact(-500000)).toBe("-$5.0k");
  });
});
