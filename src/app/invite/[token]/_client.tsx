"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, Check } from "lucide-react";

export function AcceptInvite({
  token,
  businessName,
  role,
}: {
  token: string;
  businessName: string;
  role: string;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Couldn't accept the invitation.");
      setLoading(false);
      return;
    }
    // Switch to the newly-joined business and open it.
    await update({ activeBusinessId: data.businessId });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm p-7 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/15 text-brand-600 mx-auto dark:text-brand-400">
          <Check size={26} />
        </div>
        <h1 className="text-lg font-semibold">Join {businessName}</h1>
        <p className="muted mt-1 text-sm">
          You&apos;ve been invited as <span className="font-medium capitalize">{role}</span>.
        </p>
        {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
        <button className="btn-primary mt-5 w-full justify-center" onClick={accept} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={16} /> : "Accept invitation"}
        </button>
      </div>
    </div>
  );
}
