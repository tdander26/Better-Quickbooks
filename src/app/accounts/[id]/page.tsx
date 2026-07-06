// Single account: header + reconciliation summary, then a full register with a
// running balance. Balances accumulate oldest-first from the opening balance,
// but rows are shown newest-first like a bank statement.
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ChevronLeft, Landmark, CreditCard } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS, UNCATEGORIZED, type AccountType } from "@/lib/types";
import { getBusinessContext } from "@/lib/session";
import { PageHeader, Card, StatTile, Money, Badge, EmptyState } from "@/components/ui";
import { AccountForm } from "../_form";

export const dynamic = "force-dynamic";

export default async function AccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getBusinessContext();

  const account = await prisma.financialAccount.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!account) notFound();

  const txns = await prisma.transaction.findMany({
    where: { businessId: ctx.businessId, accountId: id },
    orderBy: { postedAt: "desc" },
    include: { splits: { include: { category: true } } },
  });

  // Running balance: accumulate oldest-first from the opening balance.
  const balanceById = new Map<string, number>();
  let running = account.openingBalanceCents;
  for (const t of [...txns].reverse()) {
    running += t.amountCents;
    balanceById.set(t.id, running);
  }
  const computedCents = running; // opening + every transaction

  const isCard = account.type === "credit_card";
  const Icon = isCard ? CreditCard : Landmark;
  const typeLabel = ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type;

  const hasReported = account.reportedBalanceCents !== null;
  const reportedCents = account.reportedBalanceCents ?? 0;
  const diff = hasReported ? computedCents - reportedCents : 0;

  return (
    <div>
      <Link
        href="/accounts"
        className="muted mb-3 inline-flex items-center gap-1 text-sm transition hover:text-[var(--text)]"
      >
        <ChevronLeft size={16} /> Accounts
      </Link>

      <PageHeader
        title={account.name}
        subtitle={`${account.institution} · ${typeLabel}`}
        actions={
          <AccountForm
            mode="edit"
            variant="ghost"
            account={{
              id: account.id,
              name: account.name,
              institution: account.institution,
              type: account.type as AccountType,
              openingBalanceCents: account.openingBalanceCents,
              openingDate: account.openingDate.toISOString(),
            }}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="col-span-2 flex items-center gap-4 p-4 md:col-span-1">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <div className="muted text-xs font-medium uppercase tracking-wide">Current balance</div>
            <div className="mt-0.5 text-2xl font-semibold">
              <Money cents={computedCents} />
            </div>
          </div>
        </Card>

        <StatTile
          label="Opening balance"
          value={formatMoney(account.openingBalanceCents)}
          sub={`on ${format(account.openingDate, "MMM d, yyyy")}`}
        />

        {hasReported && (
          <StatTile
            label="Bank reported"
            value={formatMoney(reportedCents)}
            sub={account.balanceDate ? `as of ${format(account.balanceDate, "MMM d, yyyy")}` : undefined}
          />
        )}

        {hasReported && (
          <StatTile
            label="Difference"
            value={diff === 0 ? "Reconciled" : formatMoney(diff, { signed: true })}
            sub={diff === 0 ? "Matches the bank" : "Computed − bank"}
            tone={diff === 0 ? "green" : "red"}
          />
        )}
      </div>

      <div className="mt-7">
        <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
          <h2 className="text-sm font-semibold tracking-tight">Register</h2>
          <span className="muted text-xs">
            {txns.length} {txns.length === 1 ? "transaction" : "transactions"}
          </span>
        </div>

        {txns.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            hint="Once you connect a bank feed or import a statement, activity for this account shows up here with a running balance."
          />
        ) : (
          <Card className="overflow-hidden p-0">
            {/* Desktop / tablet: table */}
            <div className="no-scrollbar hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="muted border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)" }}>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Details</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b last:border-0 transition hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="whitespace-nowrap px-4 py-3 align-top tabular-nums">
                        {format(t.postedAt, "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{t.payee || t.description || "—"}</span>
                          {t.pending && <Badge tone="amber">Pending</Badge>}
                        </div>
                        {t.description && t.description !== t.payee && (
                          <div className="muted mt-0.5 text-xs">{t.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <TxnCategory splits={t.splits} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right align-top">
                        <Money cents={t.amountCents} />
                      </td>
                      <td className="muted whitespace-nowrap px-4 py-3 text-right align-top tabular-nums">
                        {formatMoney(balanceById.get(t.id) ?? computedCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
              {txns.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-col gap-1.5 px-4 py-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{t.payee || t.description || "—"}</span>
                    <Money cents={t.amountCents} className="shrink-0" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="muted tabular-nums text-xs">
                      {format(t.postedAt, "MMM d, yyyy")}
                    </span>
                    <TxnCategory splits={t.splits} />
                    {t.pending && <Badge tone="amber">Pending</Badge>}
                    <span className="muted ml-auto tabular-nums text-xs">
                      Bal {formatMoney(balanceById.get(t.id) ?? computedCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function TxnCategory({
  splits,
}: {
  splits: { category: { name: string; color: string } | null }[];
}) {
  if (splits.length > 1) return <Badge tone="blue">Split</Badge>;
  const cat = splits[0]?.category ?? null;
  if (!cat) return <Badge tone="amber">{UNCATEGORIZED}</Badge>;
  return (
    <span className="chip bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300">
      {cat.color ? (
        <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
      ) : null}
      {cat.name}
    </span>
  );
}
