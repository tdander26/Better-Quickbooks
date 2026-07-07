// Curated tax-form line options for mapping categories to a tax return.
//
// Two forms are offered so the owner can pick whichever matches their entity:
//   • Schedule C — sole proprietors / single-member LLCs (filed on the 1040)
//   • Form 1120-S — S corporations (profit flows to the owner via a K-1)
//
// The stored value on Category.taxLine is the human-readable `value` string
// (e.g. "1120-S, Line 16 — Advertising"). Keeping it a plain string means the
// tax page can keep grouping by it and no schema migration is needed. The
// Schedule C `value`s intentionally match the strings the seed already writes,
// so existing categories stay selected in the picker.

export type TaxForm = "schedule_c" | "1120s";
export type TaxSection = "income" | "expense";

export interface TaxLineOption {
  /** Stored on Category.taxLine and shown in the tax summary. */
  value: string;
  form: TaxForm;
  section: TaxSection;
}

export const TAX_FORM_LABELS: Record<TaxForm, string> = {
  schedule_c: "Schedule C · Sole proprietor / single-member LLC",
  "1120s": "Form 1120-S · S corporation",
};

// Order within each form roughly follows the printed form's line order.
export const TAX_LINES: TaxLineOption[] = [
  // ── Schedule C — income ────────────────────────────────────────────────────
  { form: "schedule_c", section: "income", value: "Schedule C, Line 1 — Gross receipts" },
  { form: "schedule_c", section: "income", value: "Schedule C, Line 6 — Other income" },
  { form: "schedule_c", section: "income", value: "Schedule B, Line 1 — Interest" },
  // ── Schedule C — expenses (Part II) ────────────────────────────────────────
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 8 — Advertising" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 9 — Car & truck" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 10 — Commissions & fees" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 11 — Contract labor" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 13 — Depreciation & §179" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 14 — Employee benefit programs" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 15 — Insurance" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 16b — Interest (other)" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 17 — Legal & professional" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 18 — Office expense" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 19 — Pension & profit-sharing" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 20a — Rent (vehicles & equipment)" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 20b — Rent (other)" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 21 — Repairs & maintenance" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 22 — Supplies" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 23 — Taxes & licenses" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 24a — Travel" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 24b — Meals" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 25 — Utilities" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 26 — Wages" },
  { form: "schedule_c", section: "expense", value: "Schedule C, Line 27a — Other expenses" },

  // ── Form 1120-S — income (page 1) ──────────────────────────────────────────
  { form: "1120s", section: "income", value: "1120-S, Line 1a — Gross receipts or sales" },
  { form: "1120s", section: "income", value: "1120-S, Line 4 — Net gain (Form 4797)" },
  { form: "1120s", section: "income", value: "1120-S, Line 5 — Other income" },
  { form: "1120s", section: "income", value: "1120-S, Sch. K Line 4 — Interest income" },
  // ── Form 1120-S — deductions (page 1) ──────────────────────────────────────
  { form: "1120s", section: "expense", value: "1120-S, Line 7 — Compensation of officers" },
  { form: "1120s", section: "expense", value: "1120-S, Line 8 — Salaries & wages" },
  { form: "1120s", section: "expense", value: "1120-S, Line 9 — Repairs & maintenance" },
  { form: "1120s", section: "expense", value: "1120-S, Line 10 — Bad debts" },
  { form: "1120s", section: "expense", value: "1120-S, Line 11 — Rents" },
  { form: "1120s", section: "expense", value: "1120-S, Line 12 — Taxes & licenses" },
  { form: "1120s", section: "expense", value: "1120-S, Line 13 — Interest" },
  { form: "1120s", section: "expense", value: "1120-S, Line 14 — Depreciation" },
  { form: "1120s", section: "expense", value: "1120-S, Line 16 — Advertising" },
  { form: "1120s", section: "expense", value: "1120-S, Line 17 — Pension & profit-sharing plans" },
  { form: "1120s", section: "expense", value: "1120-S, Line 18 — Employee benefit programs" },
  { form: "1120s", section: "expense", value: "1120-S, Line 19 — Other deductions" },
];

/** Options valid for a given P&L section (income or expense), grouped by form. */
export function taxLineGroupsForSection(
  section: string
): { form: TaxForm; label: string; options: TaxLineOption[] }[] {
  if (section !== "income" && section !== "expense") return [];
  const forms: TaxForm[] = ["schedule_c", "1120s"];
  return forms
    .map((form) => ({
      form,
      label: TAX_FORM_LABELS[form],
      options: TAX_LINES.filter((o) => o.form === form && o.section === section),
    }))
    .filter((g) => g.options.length > 0);
}

/** Which categories can carry a tax line at all. */
export function sectionSupportsTaxLine(section: string): boolean {
  return section === "income" || section === "expense";
}
