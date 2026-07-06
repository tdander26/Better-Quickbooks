// Bank reconciliation — the classic "tick off what's cleared until you match the
// statement" workflow. A Server Component: it either shows an account picker
// (no ?account=) or loads one account's transactions + last statement and hands
// them to the interactive workspace in _client.tsx.
//
// INTEGRATOR NOTES (wiring this into the rest of the app):
//   1. Add a nav link to "/reconcile" in src/components/AppShell.tsx (e.g. a
//      { href: "/reconcile", label: "Reconcile", icon: CheckCheck } entry in NAV).
//   2. On the account detail page (src/app/accounts/[id]/page.tsx) add a
//      "Reconcile" button linking to `/reconcile?account=${account.id}` — a good
//      spot is the PageHeader `actions` next to the Edit button.
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { CheckCheck, Landmark, CreditCard, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { getBusinessContext } from "@/lib/session";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/types";
import { PageHeader, Card, Money, Badge, EmptyState } from "@/components/ui";
import { ReconcileWorkspace, type ReconcileTxn } from "./_client";

// Financial data is per-request; never statically cache.
export const dynamic = "force-dynamic";

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getBusinessContext();
  const sp = await searchParams;
  const accountId = (sp.account ?? "").trim();

  // ---------------------------------------------------------------- Picker ---
  if (!accountId) {
    const accounts = await prisma.financialAccount.findMany({
      where: { businessId: ctx.businessId, archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    const cards = await Promise.all(
      accounts.map(async (a) => {
        const [agg, uncleared] = await Promise.all([
          prisma.transaction.aggregate({
            where: { accountId: a.id, businessId: ctx.businessId },
            _sum: { amountCents: true },
          }),
          prisma.transaction.count({
            where: { accountId: a.id, businessId: ctx.businessId, clearedStatus: "uncleared" },
          }),
        ]);
        return {
          id: a.id,
          name: a.name,
          institution: a.institution,
          type: a.type as AccountType,
          currentCents: a.openingBalanceCents + (agg._sum.amountCents ?? 0),
          unclearedCount: uncleared,
        };
      })
    );

    return (
      <div>
        <PageHeader
          title="Reconcile"
          subtitle="Match your books to a bank statement, one account at a time."
        />

        {cards.length === 0 ? (
          <EmptyState
            title="No accounts to reconcile"
            hint="Add a checking account or credit card first, then come back to reconcile it against a statement."
            action={
              <Link href="/accounts" className="btn-primary mt-1">
                Go to accounts
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((a) => {
              const Icon = a.type === "credit_card" ? CreditCard : Landmark;
              const typeLabel = ACCOUNT_TYPE_LABELS[a.type] ?? a.type;
              return (
                <Card key={a.id} className="flex flex-col gap-4 p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{a.name}</div>
                      <div className="muted truncate text-xs">
                        {a.institution} · {typeLabel}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="muted text-xs font-medium uppercase tracking-wide">
                        Current balance
                      </div>
                      <div className="mt-0.5 text-xl font-semibold">
                        <Money cents={a.currentCents} />
                      </div>
                    </div>
                    <Badge tone={a.unclearedCount > 0 ? "amber" : "green"}>
                      {a.unclearedCount === 0
                        ? "All cleared"
                        : `${a.unclearedCount} uncleared`}
                    </Badge>
                  </div>

                  <Link
                    href={`/reconcile?account=${a.id}`}
                    className="btn-primary justify-center"
                  >
                    <CheckCheck size={16} />
                    Reconcile
                  </Link>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ Workspace ---
  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, businessId: ctx.businessId },
  });
  if (!account) notFound();

  const [txns, lastStatement] = await Promise.all([
    prisma.transaction.findMany({
      where: { accountId, businessId: ctx.businessId },
      orderBy: { postedAt: "asc" },
    }),
    prisma.statement.findFirst({
      where: { accountId, businessId: ctx.businessId },
      orderBy: { reconciledAt: "desc" },
    }),
  ]);

  const rows: ReconcileTxn[] = txns.map((t) => ({
    id: t.id,
    postedAt: t.postedAt.toISOString(),
    amountCents: t.amountCents,
    payee: t.payee,
    description: t.description,
    clearedStatus: t.clearedStatus as ReconcileTxn["clearedStatus"],
  }));

  const typeLabel = ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type;

  return (
    <div>
      <Link
        href="/reconcile"
        className="muted mb-3 inline-flex items-center gap-1 text-sm transition hover:text-[var(--text)]"
      >
        <ChevronRight size={16} className="rotate-180" /> All accounts
      </Link>

      <PageHeader
        title={`Reconcile ${account.name}`}
        subtitle={
          lastStatement
            ? `${account.institution} · ${typeLabel} · Last reconciled on ${format(
                lastStatement.reconciledAt,
                "MMM d, yyyy"
              )}`
            : `${account.institution} · ${typeLabel} · Not yet reconciled`
        }
      />

      <ReconcileWorkspace
        account={{
          id: account.id,
          name: account.name,
          openingBalanceCents: account.openingBalanceCents,
        }}
        transactions={rows}
        lastReconciledAt={lastStatement?.reconciledAt.toISOString() ?? null}
      />
    </div>
  );
}
