// Accounts overview: net worth + assets/liabilities totals, then every account
// grouped by institution with reconciliation against the bank-reported balance.
import Link from "next/link";
import { format } from "date-fns";
import { Landmark, CreditCard, ChevronRight, Check, AlertTriangle } from "lucide-react";
import { accountBalances, type AccountBalance } from "@/lib/reports";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/types";
import { PageHeader, StatTile, Money, Badge, EmptyState } from "@/components/ui";
import { AccountForm } from "./_form";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const balances = await accountBalances();

  let assetsCents = 0;
  let liabilitiesCents = 0;
  for (const b of balances) {
    if (b.classification === "asset") assetsCents += b.computedCents;
    else liabilitiesCents += -b.computedCents; // stored negative -> positive owed
  }
  const netWorthCents = assetsCents - liabilitiesCents;

  const assetCount = balances.filter((b) => b.classification === "asset").length;
  const liabilityCount = balances.length - assetCount;

  // Group by institution, preserving the sortOrder-driven order of first sight.
  const groups = new Map<string, AccountBalance[]>();
  for (const b of balances) {
    const key = b.institution?.trim() || "Other";
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Balances across every bank and card"
        actions={<AccountForm mode="create" />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="col-span-2 md:col-span-1">
          <StatTile
            label="Net worth"
            value={formatMoney(netWorthCents)}
            sub="Assets minus liabilities"
            tone={netWorthCents >= 0 ? "green" : "red"}
          />
        </div>
        <StatTile
          label="Total assets"
          value={formatMoney(assetsCents)}
          sub={`${assetCount} ${assetCount === 1 ? "account" : "accounts"}`}
        />
        <StatTile
          label="Total liabilities"
          value={formatMoney(liabilitiesCents)}
          sub={`${liabilityCount} ${liabilityCount === 1 ? "account" : "accounts"}`}
        />
      </div>

      {balances.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No accounts yet"
            hint="Add your first checking account or credit card to start tracking balances and transactions."
            action={<AccountForm mode="create" triggerLabel="Add your first account" />}
          />
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-7">
          {[...groups.entries()].map(([institution, accts]) => {
            const groupNet = accts.reduce((n, a) => n + a.computedCents, 0);
            return (
              <section key={institution}>
                <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold tracking-tight">{institution}</h2>
                    <span className="muted text-xs">
                      {accts.length} {accts.length === 1 ? "account" : "accounts"}
                    </span>
                  </div>
                  <span className="muted tabular-nums text-xs font-medium">
                    {formatMoney(groupNet)}
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  {accts.map((b) => (
                    <AccountRow key={b.id} account={b} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AccountRow({ account: b }: { account: AccountBalance }) {
  const isCard = b.type === "credit_card";
  const Icon = isCard ? CreditCard : Landmark;
  const hasReported = b.reportedCents !== null;
  const diff = hasReported ? b.computedCents - (b.reportedCents as number) : 0;
  const reconciled = hasReported && diff === 0;

  return (
    <Link
      href={`/accounts/${b.id}`}
      className="card group flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
        <Icon size={20} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{b.name}</span>
          <Badge tone={isCard ? "amber" : "blue"}>
            {ACCOUNT_TYPE_LABELS[b.type as AccountType] ?? b.type}
          </Badge>
        </div>
        <div className="muted mt-0.5 truncate text-xs">
          {hasReported ? (
            <>
              Bank reports {formatMoney(b.reportedCents as number)}
              {b.balanceDate ? <> · as of {format(b.balanceDate, "MMM d")}</> : null}
            </>
          ) : (
            "Balance from your records"
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 text-right">
        <Money cents={b.computedCents} className="font-semibold" />
        {hasReported &&
          (reconciled ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Check size={12} /> Reconciled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle size={12} /> Off by {formatMoney(Math.abs(diff))}
            </span>
          ))}
      </div>

      <ChevronRight
        size={16}
        className="muted hidden shrink-0 transition group-hover:translate-x-0.5 sm:block"
      />
    </Link>
  );
}
