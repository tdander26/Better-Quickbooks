// Stripe server client + plan config. Server (Node) only. Everything is
// optional-by-env so the app runs fine without billing configured (dev): the
// client is null and stripeConfigured() is false until keys are set.
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = secretKey ? new Stripe(secretKey) : null;

// The subscription price the "Upgrade" button checks out.
export const PRICE_ID = process.env.STRIPE_PRICE_ID || process.env.NEXT_PUBLIC_STRIPE_PRICE_ID || "";

export function stripeConfigured(): boolean {
  return Boolean(stripe && PRICE_ID);
}
