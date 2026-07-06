// Stripe webhook — keeps each Business's subscription status in sync. PUBLIC
// (allowlisted in middleware): it authenticates via the Stripe signature over
// the RAW request body, not a session. Never route this through the tenant guard.
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

async function syncSubscription(sub: Stripe.Subscription) {
  const businessId = sub.metadata?.businessId;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const where = businessId ? { id: businessId } : { stripeCustomerId: customerId };
  const activeish = sub.status === "active" || sub.status === "trialing";

  await prisma.business.updateMany({
    where,
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      stripePriceId: sub.items.data[0]?.price?.id ?? null,
      subscriptionStatus: sub.status,
      plan: activeish ? "pro" : "free",
      currentPeriodEnd: sub.items.data[0]?.current_period_end
        ? new Date(sub.items.data[0].current_period_end * 1000)
        : null,
    },
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!stripe || !secret || !sig) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (typeof s.subscription === "string") {
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
        if (customerId) {
          await prisma.business.updateMany({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: "past_due" },
          });
        }
        break;
      }
    }
  } catch (e) {
    // Log and 500 so Stripe retries.
    console.error("[stripe:webhook] handler error", e);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
