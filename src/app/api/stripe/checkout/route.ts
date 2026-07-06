// Start a Stripe Checkout session to subscribe the active business. Owner-only.
// Uses skipBilling so a lapsed business can still reach checkout to pay.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessContext } from "@/lib/session";
import { stripe, PRICE_ID, stripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await requireBusinessContext({ minRole: "owner", skipBilling: true });
  if (ctx instanceof NextResponse) return ctx;
  if (!stripe || !stripeConfigured()) {
    return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 400 });
  }

  let customerId = ctx.business.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: ctx.user.email || undefined,
      name: ctx.business.name,
      metadata: { businessId: ctx.businessId },
    });
    customerId = customer.id;
    await prisma.business.update({
      where: { id: ctx.businessId },
      data: { stripeCustomerId: customerId },
    });
  }

  const origin = req.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    success_url: `${origin}/settings/billing?status=success`,
    cancel_url: `${origin}/settings/billing?status=cancel`,
    metadata: { businessId: ctx.businessId },
    subscription_data: { metadata: { businessId: ctx.businessId } },
  });

  return NextResponse.json({ url: session.url });
}
