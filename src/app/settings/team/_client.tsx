"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Loader2, Trash2, Mail, Shield, Crown, User } from "lucide-react";

export interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: string;
}
export interface PendingInvite {
  id: string;
  email: string;
  role: string;
}

const roleIcon: Record<string, typeof Crown> = { owner: Crown, admin: Shield, member: User };

export function TeamManager({
  members,
  invites,
  myUserId,
  canManage,
}: {
  members: Member[];
  invites: PendingInvite[];
  myUserId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/business/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Couldn't send the invite.");
      return;
    }
    setEmail("");
    setNotice(
      data.dev || data.emailError
        ? `Invite created. Share this link: ${data.inviteUrl}`
        : `Invitation sent to ${data.invite.email}.`
    );
    router.refresh();
  }

  async function revoke(id: string) {
    await fetch(`/api/business/invites/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function remove(userId: string) {
    const res = await fetch(`/api/business/members/${userId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't remove that member.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Members */}
      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 text-base font-semibold">Members</h2>
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {members.map((m) => {
            const Icon = roleIcon[m.role] ?? User;
            return (
              <li key={m.userId} className="flex items-center gap-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10">
                  <Icon size={16} className="muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.name || m.email}
                    {m.userId === myUserId && <span className="muted"> (you)</span>}
                  </div>
                  <div className="muted truncate text-xs">{m.email}</div>
                </div>
                <span className="chip bg-black/5 capitalize dark:bg-white/10">{m.role}</span>
                {canManage && m.userId !== myUserId && (
                  <button
                    onClick={() => remove(m.userId)}
                    className="muted p-1.5 transition hover:text-rose-500"
                    title="Remove member"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Invite form */}
      {canManage && (
        <section className="card p-5 sm:p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
            <UserPlus size={17} /> Invite a teammate
          </h2>
          <p className="muted mb-4 text-sm">They&apos;ll get an email link to join this business.</p>
          <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              required
              placeholder="teammate@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input flex-1"
            />
            <select value={role} onChange={(e) => setRole(e.target.value)} className="input sm:w-36">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn-primary" disabled={busy || !email}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : "Send invite"}
            </button>
          </form>
          {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
          {notice && <p className="mt-3 break-all text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
        </section>
      )}

      {/* Pending invites */}
      {canManage && invites.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="mb-4 text-base font-semibold">Pending invites</h2>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10">
                  <Mail size={16} className="muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.email}</div>
                  <div className="muted text-xs capitalize">{i.role} · pending</div>
                </div>
                <button
                  onClick={() => revoke(i.id)}
                  className="muted p-1.5 transition hover:text-rose-500"
                  title="Revoke invite"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
