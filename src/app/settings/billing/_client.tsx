"use client";

import { useState } from "react";
import { Loader2, CreditCard, Sparkles } from "lucide-react";

export function BillingActions({
  hasCustomer,
  configured,
}: {
  hasCustomer: boolean;
  configured: boolean;
}) {
  const [loading, setLoading] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState("");

  async function go(kind: "checkout" | "portal") {
    setLoading(kind);
    setError("");
    const res = await fetch(`/api/stripe/${kind}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.href = data.url;
      return;
    }
    setError(data.error || "Something went wrong.");
    setLoading(null);
  }

  if (!configured) {
    return (
      <p className="muted text-sm">
        Billing isn&apos;t configured on this deployment yet. Set <code>STRIPE_SECRET_KEY</code>,{" "}
        <code>STRIPE_PRICE_ID</code>, and <code>STRIPE_WEBHOOK_SECRET</code> to enable subscriptions.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => go("checkout")} disabled={loading !== null}>
          {loading === "checkout" ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          Upgrade to Pro
        </button>
        {hasCustomer && (
          <button className="btn-ghost" onClick={() => go("portal")} disabled={loading !== null}>
            {loading === "portal" ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
            Manage billing
          </button>
        )}
      </div>
      {error && <p className="text-sm text-rose-500">{error}</p>}
    </div>
  );
}
