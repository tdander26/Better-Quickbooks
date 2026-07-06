// Billing & subscription for the active business. Viewable by any member;
// upgrade/manage actions are owner-only (enforced by the API routes). Uses
// allowInactiveBilling so a lapsed business can still open this page to pay.
import { format } from "date-fns";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { getBusinessContext, hasRole } from "@/lib/session";
import { isBillingActive } from "@/lib/billing";
import { stripeConfigured } from "@/lib/stripe";
import { PageHeader, Card, StatTile } from "@/components/ui";
import { BillingActions } from "./_client";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
};

export default async function BillingPage() {
  const ctx = await getBusinessContext({ allowInactiveBilling: true });
  const b = ctx.business;
  const active = isBillingActive(b);
  const isOwner = hasRole(ctx.role, "owner");

  const statusLabel = STATUS_LABEL[b.subscriptionStatus] ?? b.subscriptionStatus;
  const Icon = active ? (b.subscriptionStatus === "trialing" ? Clock : CheckCircle2) : AlertTriangle;
  const tone = active ? "green" : "red";

  return (
    <div className="space-y-5">
      <PageHeader title="Billing" subtitle={`Subscription for ${b.name}`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Plan" value={b.plan === "pro" ? "Pro" : "Free"} sub="Current plan" />
        <StatTile label="Status" value={statusLabel} tone={tone} sub="Subscription" />
        {b.currentPeriodEnd && (
          <StatTile
            label="Renews"
            value={format(b.currentPeriodEnd, "MMM d, yyyy")}
            sub="Next billing date"
          />
        )}
      </div>

      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
              active
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            }`}
          >
            <Icon size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight">
              {active ? "Your subscription is active" : "Subscription needed"}
            </h2>
            <p className="muted mt-0.5 text-sm">
              {active
                ? "Thanks for subscribing — everything's unlocked."
                : "Reactivate your subscription to keep using this business."}
            </p>
          </div>
        </div>

        {isOwner ? (
          <BillingActions hasCustomer={Boolean(b.stripeCustomerId)} configured={stripeConfigured()} />
        ) : (
          <p className="muted text-sm">Only an owner can manage billing for this business.</p>
        )}
      </Card>
    </div>
  );
}
