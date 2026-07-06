// Open the Stripe Billing Portal so an owner can manage/cancel their
// subscription and payment method. Owner-only; skipBilling so a lapsed business
// can still reach it.
import { NextRequest, NextResponse } from "next/server";
import { requireBusinessContext } from "@/lib/session";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await requireBusinessContext({ minRole: "owner", skipBilling: true });
  if (ctx instanceof NextResponse) return ctx;
  if (!stripe) {
    return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 400 });
  }
  if (!ctx.business.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account yet — subscribe first." }, { status: 400 });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: ctx.business.stripeCustomerId,
    return_url: `${req.nextUrl.origin}/settings/billing`,
  });

  return NextResponse.json({ url: session.url });
}
