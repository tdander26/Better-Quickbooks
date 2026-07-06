// Invitation landing page. Public (allowlisted in middleware). Handles the
// logged-out, wrong-email, expired, and ready-to-accept cases.
import Link from "next/link";
import { AlertTriangle, Wallet } from "lucide-react";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { AcceptInvite } from "./_client";

export const dynamic = "force-dynamic";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm p-7 text-center">{children}</div>
    </div>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({ where: { token }, include: { business: true } });
  const session = await auth();

  if (!invite || invite.status !== "pending" || invite.expiresAt.getTime() < Date.now()) {
    return (
      <Centered>
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-600 mx-auto dark:text-amber-400">
          <AlertTriangle size={26} />
        </div>
        <h1 className="text-lg font-semibold">Invitation unavailable</h1>
        <p className="muted mt-1 text-sm">This invitation is no longer valid or has expired.</p>
        <Link href="/login" className="btn-ghost mt-5 w-full justify-center">
          Go to sign in
        </Link>
      </Centered>
    );
  }

  const next = encodeURIComponent(`/invite/${token}`);

  if (!session?.user?.id) {
    return (
      <Centered>
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/15 text-brand-600 mx-auto dark:text-brand-400">
          <Wallet size={26} />
        </div>
        <h1 className="text-lg font-semibold">Join {invite.business.name}</h1>
        <p className="muted mt-1 text-sm">
          Create an account (or sign in) with <span className="font-medium">{invite.email}</span> to accept.
        </p>
        <Link href={`/signup?next=${next}`} className="btn-primary mt-5 w-full justify-center">
          Create an account
        </Link>
        <Link href={`/login?next=${next}`} className="btn-ghost mt-2 w-full justify-center">
          I already have an account
        </Link>
      </Centered>
    );
  }

  const emailMatches = (session.user.email ?? "").toLowerCase() === invite.email.toLowerCase();
  if (!emailMatches) {
    return (
      <Centered>
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-600 mx-auto dark:text-amber-400">
          <AlertTriangle size={26} />
        </div>
        <h1 className="text-lg font-semibold">Different email</h1>
        <p className="muted mt-1 text-sm">
          This invitation was sent to <span className="font-medium">{invite.email}</span>, but
          you&apos;re signed in as <span className="font-medium">{session.user.email}</span>. Sign in
          with the invited email to accept.
        </p>
      </Centered>
    );
  }

  return <AcceptInvite token={token} businessName={invite.business.name} role={invite.role} />;
}
