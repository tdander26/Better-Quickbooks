// Team management for the active business: members, roles, and invites.
import { prisma } from "@/lib/db";
import { getBusinessContext, hasRole } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { TeamManager, type Member, type PendingInvite } from "./_client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const ctx = await getBusinessContext();

  const [memberships, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { businessId: ctx.businessId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invite.findMany({
      where: { businessId: ctx.businessId, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const members: Member[] = memberships.map((m) => ({
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
  }));
  const pending: PendingInvite[] = invites.map((i) => ({ id: i.id, email: i.email, role: i.role }));

  return (
    <div>
      <PageHeader title="Team" subtitle={`Who can access ${ctx.business.name}`} />
      <TeamManager
        members={members}
        invites={pending}
        myUserId={ctx.user.id}
        canManage={hasRole(ctx.role, "admin")}
      />
    </div>
  );
}
