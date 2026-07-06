// Subscription gating — single source of truth for "can this business use the
// app right now?". Read by the tenant guards (src/lib/session.ts) and billing UI.
import type { Business } from "@prisma/client";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function isBillingActive(
  business: Pick<Business, "subscriptionStatus" | "trialEndsAt">
): boolean {
  if (ACTIVE_STATUSES.has(business.subscriptionStatus)) return true;
  if (business.trialEndsAt && business.trialEndsAt.getTime() > Date.now()) return true;
  return false;
}
