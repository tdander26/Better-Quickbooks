// Settings — the app's control room.
//   1) Bank feed (SimpleFIN): connect a token or hit the marquee "Refresh now".
//   2) CSV import: bring transactions in from a spreadsheet / bank export.
//   3) Chart of accounts: add / rename / delete categories, grouped by section.
//   4) Security & app: how the PIN + encryption are configured, plus Sign out.
import { format } from "date-fns";
import { ShieldCheck, KeyRound, Lock } from "lucide-react";
import { prisma } from "@/lib/db";
import { getBusinessContext } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { SignOutButton } from "@/components/SignOutButton";
import {
  BankFeedCard,
  CsvImportCard,
  ChartOfAccountsCard,
  type ConnectionInfo,
  type AccountLite,
  type CategoryLite,
} from "./_client";

export const dynamic = "force-dynamic";

/** Compact relative time, computed on the server so there's no hydration drift. */
function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.round(day / 30);
  return `${mo} month${mo === 1 ? "" : "s"} ago`;
}

export default async function SettingsPage() {
  const ctx = await getBusinessContext();
  const [connection, accounts, categories] = await Promise.all([
    prisma.feedConnection.findFirst({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.financialAccount.findMany({
      where: { businessId: ctx.businessId, archived: false },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.category.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  const linkedAccounts = connection
    ? await prisma.financialAccount.count({
        where: { businessId: ctx.businessId, connectionId: connection.id, archived: false },
      })
    : 0;

  const connectionInfo: ConnectionInfo | null = connection
    ? {
        id: connection.id,
        status: connection.status,
        lastSyncedRel: connection.lastSyncedAt ? relativeTime(connection.lastSyncedAt) : null,
        lastSyncedAbs: connection.lastSyncedAt
          ? format(connection.lastSyncedAt, "MMM d, yyyy 'at' h:mm a")
          : null,
        lastError: connection.lastError,
        linkedAccounts,
      }
    : null;

  const accountList: AccountLite[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    institution: a.institution,
    type: a.type,
  }));

  const categoryList: CategoryLite[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    section: c.section,
    icon: c.icon,
    isSystem: c.isSystem,
  }));

  return (
    <div>
      <PageHeader title="Settings" subtitle="Connect your bank, import history, and shape your books" />

      <div className="flex flex-col gap-5">
        <BankFeedCard connection={connectionInfo} />
        <CsvImportCard accounts={accountList} />
        <ChartOfAccountsCard categories={categoryList} />

        {/* 4) Security & app */}
        <section className="card p-5 sm:p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-slate-500 to-slate-700 text-white shadow-sm">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold leading-tight">Security &amp; app</h2>
              <p className="muted mt-0.5 text-sm">How your account and data are protected</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound size={15} className="text-brand-600 dark:text-brand-400" />
                Login
              </div>
              <p className="muted mt-1 text-sm">
                You sign in with your email and password. Passwords are hashed with bcrypt and never
                stored in plain text. Each business&apos;s data is fully isolated from every other.
              </p>
            </div>

            <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lock size={15} className="text-brand-600 dark:text-brand-400" />
                Encryption
              </div>
              <p className="muted mt-1 text-sm">
                <code className="rounded bg-black/5 px-1 dark:bg-white/10">ENCRYPTION_KEY</code> (32
                bytes / 64 hex chars) encrypts your stored bank credentials at rest and signs your
                session. Keep it secret; never commit it.
              </p>
            </div>
          </div>

          <div
            className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="muted text-sm">
              Signed in as {ctx.user.email} · {ctx.business.name}
            </p>
            <SignOutButton />
          </div>
        </section>
      </div>
    </div>
  );
}
