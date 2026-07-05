// Reusable demo-data seeder: chart of accounts, default auto-categorization
// rules, and realistic mock Chase/Ally transactions. Shared by the CLI
// (prisma/seed.ts) and the guarded /api/admin/seed endpoint used after a fresh
// deploy. Uses the shared prisma singleton.

import { prisma } from "@/lib/db";

const c = (dollars: number) => Math.round(dollars * 100);

type Sec = "income" | "expense" | "asset" | "liability" | "equity" | "transfer";

const CATEGORIES: { name: string; section: Sec; icon?: string; system?: boolean }[] = [
  { name: "Patient Revenue", section: "income", icon: "stethoscope" },
  { name: "Consulting Income", section: "income", icon: "briefcase" },
  { name: "Interest Income", section: "income", icon: "percent" },
  { name: "Other Income", section: "income", icon: "plus-circle" },
  { name: "Payroll", section: "expense", icon: "users" },
  { name: "Rent", section: "expense", icon: "building" },
  { name: "Medical Supplies", section: "expense", icon: "cross" },
  { name: "Office Supplies", section: "expense", icon: "paperclip" },
  { name: "Software & Subscriptions", section: "expense", icon: "monitor" },
  { name: "Insurance", section: "expense", icon: "shield" },
  { name: "Utilities", section: "expense", icon: "zap" },
  { name: "Meals & Entertainment", section: "expense", icon: "utensils" },
  { name: "Travel", section: "expense", icon: "plane" },
  { name: "Professional Fees", section: "expense", icon: "scale" },
  { name: "Continuing Education", section: "expense", icon: "graduation-cap" },
  { name: "Bank & Merchant Fees", section: "expense", icon: "credit-card" },
  { name: "Taxes", section: "expense", icon: "landmark" },
  { name: "Auto & Fuel", section: "expense", icon: "car" },
  { name: "Marketing", section: "expense", icon: "megaphone" },
  { name: "Uncategorized", section: "expense", icon: "help-circle", system: true },
  { name: "Owner's Draw", section: "equity", icon: "arrow-up-circle" },
  { name: "Owner's Contribution", section: "equity", icon: "arrow-down-circle" },
  { name: "Transfer", section: "transfer", icon: "repeat", system: true },
  { name: "Credit Card Payment", section: "transfer", icon: "credit-card" },
];

const RULES: {
  name: string;
  priority: number;
  matchField: string;
  operator: string;
  value: string;
  category: string;
  markTransfer?: boolean;
}[] = [
  { name: "Online transfers", priority: 10, matchField: "description", operator: "contains", value: "online transfer", category: "Transfer", markTransfer: true },
  { name: "Zelle", priority: 11, matchField: "description", operator: "contains", value: "zelle", category: "Transfer", markTransfer: true },
  { name: "Card payment (thank you)", priority: 12, matchField: "description", operator: "contains", value: "payment thank you", category: "Credit Card Payment", markTransfer: true },
  { name: "Card autopay", priority: 13, matchField: "description", operator: "contains", value: "autopay", category: "Credit Card Payment", markTransfer: true },
  { name: "Payroll (Gusto)", priority: 50, matchField: "description", operator: "contains", value: "gusto", category: "Payroll" },
  { name: "Payroll (ADP)", priority: 51, matchField: "description", operator: "contains", value: "adp", category: "Payroll" },
  { name: "IRS / Treasury", priority: 52, matchField: "description", operator: "contains", value: "irs", category: "Taxes" },
  { name: "EFTPS tax", priority: 53, matchField: "description", operator: "contains", value: "eftps", category: "Taxes" },
  { name: "Amazon", priority: 60, matchField: "payee", operator: "contains", value: "amazon", category: "Office Supplies" },
  { name: "Staples / Office Depot", priority: 61, matchField: "payee", operator: "contains", value: "staples", category: "Office Supplies" },
  { name: "Adobe", priority: 62, matchField: "payee", operator: "contains", value: "adobe", category: "Software & Subscriptions" },
  { name: "Google / Microsoft", priority: 63, matchField: "payee", operator: "contains", value: "google", category: "Software & Subscriptions" },
  { name: "Zoom", priority: 64, matchField: "payee", operator: "contains", value: "zoom", category: "Software & Subscriptions" },
  { name: "Fuel (Shell/Exxon/BP)", priority: 65, matchField: "payee", operator: "contains", value: "shell", category: "Auto & Fuel" },
  { name: "Rideshare (Uber/Lyft)", priority: 66, matchField: "payee", operator: "contains", value: "uber", category: "Travel" },
  { name: "Airlines (Delta)", priority: 67, matchField: "payee", operator: "contains", value: "delta", category: "Travel" },
  { name: "Coffee (Starbucks)", priority: 68, matchField: "payee", operator: "contains", value: "starbucks", category: "Meals & Entertainment" },
  { name: "Food delivery", priority: 69, matchField: "payee", operator: "contains", value: "doordash", category: "Meals & Entertainment" },
  { name: "Insurance (State Farm)", priority: 70, matchField: "payee", operator: "contains", value: "state farm", category: "Insurance" },
  { name: "Utilities (Xfinity)", priority: 71, matchField: "payee", operator: "contains", value: "xfinity", category: "Utilities" },
  { name: "Interest paid", priority: 80, matchField: "description", operator: "contains", value: "interest", category: "Interest Income" },
  { name: "Card processing (Stripe)", priority: 81, matchField: "description", operator: "contains", value: "stripe", category: "Patient Revenue" },
  { name: "Card processing (Square)", priority: 82, matchField: "description", operator: "contains", value: "square", category: "Patient Revenue" },
];

export interface SeedResult {
  categories: number;
  rules: number;
  accounts: number;
  transactions: number;
}

/** Wipes existing data and seeds demo data. Returns counts. */
export async function seedDemoData(): Promise<SeedResult> {
  await prisma.split.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.account.deleteMany();
  await prisma.category.deleteMany();
  await prisma.feedConnection.deleteMany();

  const catId = new Map<string, string>();
  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    const created = await prisma.category.create({
      data: { name: cat.name, section: cat.section, icon: cat.icon ?? "", isSystem: cat.system ?? false, sortOrder: i },
    });
    catId.set(cat.name, created.id);
  }

  for (const r of RULES) {
    await prisma.rule.create({
      data: {
        name: r.name,
        priority: r.priority,
        matchField: r.matchField,
        operator: r.operator,
        value: r.value,
        categoryId: catId.get(r.category)!,
        markTransfer: r.markTransfer ?? false,
      },
    });
  }

  const chase = await prisma.account.create({ data: { name: "Total Checking", institution: "Chase", type: "bank", classification: "asset", openingBalanceCents: c(5000), openingDate: new Date("2026-04-01"), reportedBalanceCents: c(8420.55), balanceDate: new Date("2026-07-02"), sortOrder: 0 } });
  const allyChecking = await prisma.account.create({ data: { name: "Interest Checking", institution: "Ally", type: "bank", classification: "asset", openingBalanceCents: c(3000), openingDate: new Date("2026-04-01"), reportedBalanceCents: c(4115.2), balanceDate: new Date("2026-07-02"), sortOrder: 1 } });
  const allySavings = await prisma.account.create({ data: { name: "Online Savings", institution: "Ally", type: "bank", classification: "asset", openingBalanceCents: c(20000), openingDate: new Date("2026-04-01"), reportedBalanceCents: c(20180.4), balanceDate: new Date("2026-07-02"), sortOrder: 2 } });
  const sapphire = await prisma.account.create({ data: { name: "Sapphire Card", institution: "Chase", type: "credit_card", classification: "liability", openingBalanceCents: c(0), openingDate: new Date("2026-04-01"), reportedBalanceCents: c(-1840.32), balanceDate: new Date("2026-07-02"), sortOrder: 3 } });

  const acctMap: Record<string, string> = { chase: chase.id, allyC: allyChecking.id, allyS: allySavings.id, card: sapphire.id };
  const rows: { acct: string; date: string; amount: number; payee: string; description: string; category?: string; pending?: boolean }[] = [];

  for (const [mo] of [["04"], ["05"], ["06"]] as const) {
    rows.push({ acct: "chase", date: `2026-${mo}-05`, amount: 9800 + Math.round(Math.random() * 1500), payee: "Stripe", description: "STRIPE TRANSFER PAYOUT", category: "Patient Revenue" });
    rows.push({ acct: "chase", date: `2026-${mo}-19`, amount: 8600 + Math.round(Math.random() * 1500), payee: "Square", description: "SQUARE INC DEPOSIT", category: "Patient Revenue" });
    rows.push({ acct: "chase", date: `2026-${mo}-22`, amount: 4200, payee: "BCBS", description: "BCBS MN CLAIM PAYMENT", category: "Patient Revenue" });
    rows.push({ acct: "chase", date: `2026-${mo}-15`, amount: -6200, payee: "Gusto", description: "GUSTO PAYROLL", category: "Payroll" });
    rows.push({ acct: "chase", date: `2026-${mo}-15`, amount: -1180, payee: "Gusto", description: "GUSTO TAX EFTPS", category: "Taxes" });
    rows.push({ acct: "chase", date: `2026-${mo}-01`, amount: -3500, payee: "Corcoran Medical Plaza", description: "RENT ACH", category: "Rent" });
    rows.push({ acct: "card", date: `2026-${mo}-08`, amount: -184.32, payee: "Xfinity", description: "XFINITY INTERNET", category: "Utilities" });
    rows.push({ acct: "card", date: `2026-${mo}-10`, amount: -342.5, payee: "State Farm", description: "STATE FARM INSURANCE", category: "Insurance" });
    rows.push({ acct: "card", date: `2026-${mo}-12`, amount: -52.99, payee: "Adobe", description: "ADOBE CREATIVE CLOUD", category: "Software & Subscriptions" });
    rows.push({ acct: "card", date: `2026-${mo}-14`, amount: -149, payee: "Zoom", description: "ZOOM.US SUBSCRIPTION", category: "Software & Subscriptions" });
    rows.push({ acct: "card", date: `2026-${mo}-07`, amount: -640.18, payee: "Henry Schein", description: "HENRY SCHEIN MEDICAL", category: "Medical Supplies" });
    rows.push({ acct: "card", date: `2026-${mo}-17`, amount: -128.44, payee: "Amazon", description: "AMAZON.COM PURCHASE", category: "Office Supplies" });
    rows.push({ acct: "card", date: `2026-${mo}-09`, amount: -68.2, payee: "Shell", description: "SHELL OIL", category: "Auto & Fuel" });
    rows.push({ acct: "card", date: `2026-${mo}-21`, amount: -84.75, payee: "Starbucks", description: "STARBUCKS STORE", category: "Meals & Entertainment" });
    rows.push({ acct: "allyS", date: `2026-${mo}-28`, amount: 88.4 + Math.random() * 8, payee: "Ally Bank", description: "INTEREST PAID", category: "Interest Income" });
    rows.push({ acct: "chase", date: `2026-${mo}-25`, amount: -1600, payee: "Chase Card Services", description: "CHASE CREDIT CRD AUTOPAY", category: "Credit Card Payment" });
    rows.push({ acct: "card", date: `2026-${mo}-25`, amount: 1600, payee: "Chase", description: "PAYMENT THANK YOU", category: "Credit Card Payment" });
    rows.push({ acct: "chase", date: `2026-${mo}-06`, amount: -2500, payee: "Ally", description: "ONLINE TRANSFER TO ALLY", category: "Transfer" });
    rows.push({ acct: "allyS", date: `2026-${mo}-06`, amount: 2500, payee: "Chase", description: "ONLINE TRANSFER FROM CHASE", category: "Transfer" });
    rows.push({ acct: "chase", date: `2026-${mo}-27`, amount: -4000, payee: "Owner", description: "OWNER DRAW TRANSFER", category: "Owner's Draw" });
  }

  rows.push({ acct: "chase", date: "2026-07-01", amount: -3500, payee: "Corcoran Medical Plaza", description: "RENT ACH", category: "Rent" });
  rows.push({ acct: "chase", date: "2026-07-02", amount: 10250, payee: "Stripe", description: "STRIPE TRANSFER PAYOUT", category: "Patient Revenue" });
  rows.push({ acct: "card", date: "2026-07-02", amount: -212.9, payee: "Delta Air Lines", description: "DELTA AIR LINES", category: "Travel" });
  rows.push({ acct: "card", date: "2026-07-02", amount: -47.5, payee: "Kwik Trip", description: "KWIK TRIP 442", pending: true });
  rows.push({ acct: "card", date: "2026-07-03", amount: -96.13, payee: "Menards", description: "MENARDS PURCHASE", pending: true });

  // ---- Unreviewed inbox (no category => reviewed:false) --------------------
  // Feeds the Categorize cockpit: repeated merchants become Smart batches (via
  // rules or filing history); the rest are Power-grid one-offs. One Amazon
  // refund is an opposite-signed outlier so a batch surfaces a review flag.
  const inbox: { acct: string; date: string; amount: number; payee: string; description: string }[] = [
    // Amazon ×4 (rule -> Office Supplies), incl. a refund that should get flagged
    { acct: "card", date: "2026-07-01", amount: -128.44, payee: "Amazon", description: "AMAZON.COM PURCHASE" },
    { acct: "card", date: "2026-07-02", amount: -63.19, payee: "Amazon", description: "AMAZON.COM PURCHASE" },
    { acct: "card", date: "2026-07-03", amount: -212.6, payee: "Amazon", description: "AMAZON.COM PURCHASE" },
    { acct: "card", date: "2026-07-04", amount: 41.2, payee: "Amazon", description: "AMAZON.COM REFUND" },
    // Uber ×3 (rule -> Travel)
    { acct: "card", date: "2026-07-01", amount: -18.2, payee: "Uber", description: "UBER TRIP" },
    { acct: "card", date: "2026-07-02", amount: -24.75, payee: "Uber", description: "UBER TRIP" },
    { acct: "card", date: "2026-07-03", amount: -31.4, payee: "Uber", description: "UBER TRIP" },
    // Adobe ×2 (rule -> Software & Subscriptions)
    { acct: "card", date: "2026-07-01", amount: -52.99, payee: "Adobe", description: "ADOBE CREATIVE CLOUD" },
    { acct: "card", date: "2026-07-03", amount: -22.99, payee: "Adobe", description: "ADOBE STOCK" },
    // Henry Schein ×2 (no rule; suggested from filing history -> Medical Supplies)
    { acct: "card", date: "2026-07-02", amount: -418.5, payee: "Henry Schein", description: "HENRY SCHEIN MEDICAL" },
    { acct: "card", date: "2026-07-04", amount: -276.15, payee: "Henry Schein", description: "HENRY SCHEIN MEDICAL" },
    // One-offs (varied suggestion confidence)
    { acct: "chase", date: "2026-07-04", amount: 10480, payee: "Stripe", description: "STRIPE TRANSFER PAYOUT" }, // rule -> Patient Revenue
    { acct: "card", date: "2026-07-03", amount: -212.9, payee: "Shell", description: "SHELL OIL 4413" }, // rule -> Auto & Fuel
    { acct: "card", date: "2026-07-02", amount: -312.19, payee: "AWS", description: "AMAZON WEB SERVICES" }, // no match -> Choose
    { acct: "card", date: "2026-07-01", amount: -284.77, payee: "Home Depot", description: "THE HOME DEPOT #2418" }, // no match
    { acct: "card", date: "2026-07-02", amount: -42.1, payee: "USPS", description: "USPS PO 2841" }, // no match
  ];
  for (const r of inbox) rows.push(r);

  const uncategorizedId = catId.get("Uncategorized")!;
  let count = 0;
  for (const r of rows) {
    const categoryId = r.category ? catId.get(r.category)! : uncategorizedId;
    const amountCents = c(Math.round(r.amount * 100) / 100);
    await prisma.transaction.create({
      data: {
        accountId: acctMap[r.acct],
        postedAt: new Date(r.date + "T12:00:00"),
        amountCents,
        payee: r.payee,
        description: r.description,
        pending: r.pending ?? false,
        reviewed: r.category ? true : false,
        splits: { create: [{ amountCents, categoryId }] },
      },
    });
    count++;
  }

  return { categories: CATEGORIES.length, rules: RULES.length, accounts: 4, transactions: count };
}
