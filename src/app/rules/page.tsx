// Rules — auto-categorization. A Server Component: it loads every rule (in
// evaluation order) plus the category list for the target dropdown, then hands
// the interactive list + editor over to _editor.tsx.
import { prisma } from "@/lib/db";
import { Wand2 } from "lucide-react";
import { getBusinessContext } from "@/lib/session";
import { PageHeader, Card } from "@/components/ui";
import { RulesManager, type RuleRow, type RuleCategoryOption } from "./_editor";

// Rules change the moment the user edits them; never statically cache.
export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const ctx = await getBusinessContext();
  const [rules, categories] = await Promise.all([
    prisma.rule.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      include: { category: true },
    }),
    prisma.category.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ section: "asc" }, { name: "asc" }],
    }),
  ]);

  // Serialize into plain, client-safe shapes.
  const ruleRows: RuleRow[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    enabled: r.enabled,
    matchField: r.matchField,
    operator: r.operator,
    value: r.value,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? "",
    categorySection: r.category?.section ?? "",
    markTransfer: r.markTransfer,
  }));

  const categoryOptions: RuleCategoryOption[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    section: c.section,
  }));

  return (
    <div>
      <PageHeader
        title="Rules"
        subtitle="Teach Better Books to categorize transactions for you"
      />

      <Card className="mb-5 flex items-start gap-4 bg-gradient-to-br from-brand-500/[0.06] to-transparent p-5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
          <Wand2 size={20} />
        </div>
        <div className="text-sm leading-relaxed">
          <p className="font-medium">How rules work</p>
          <p className="muted mt-1">
            When a new transaction is imported, Better Books checks it against your rules from top
            to bottom. The <span className="font-medium text-[var(--text)]">first</span> rule that
            matches sets the category — a lower priority number runs first. Reorder with the arrows,
            then hit{" "}
            <span className="font-medium text-[var(--text)]">Re-apply rules now</span> to sweep
            through transactions that are still uncategorized.
          </p>
        </div>
      </Card>

      <RulesManager rules={ruleRows} categories={categoryOptions} />
    </div>
  );
}
