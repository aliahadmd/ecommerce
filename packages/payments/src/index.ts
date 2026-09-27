/**
 * PaymentProvider abstraction (plan-3). Stripe specifics never leak past
 * this interface; the fake provider is the dev/test default.
 */
export interface PaymentIntent {
  ref: string
  /** Local page for the fake gateway; Stripe Checkout URL for stripe. */
  payUrl: string
}

export type PaymentOutcome = "succeeded" | "failed"

export interface PaymentProvider {
  readonly id: "fake" | "stripe"
  createIntent(input: {
    ref: string
    amountCents: number
    currency: string
    description: string
  }): Promise<PaymentIntent>
  /** Verify a gateway callback/webhook body. Returns null when invalid. */
  verifyCallback(body: unknown): { ref: string; outcome: PaymentOutcome } | null
}

import { createHmac, timingSafeEqual } from "node:crypto"

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex")
}

/** Fake gateway: payUrl is a local page; callbacks are HMAC-signed. */
export const fakeProvider: PaymentProvider = {
  id: "fake",
  async createIntent({ ref }) {
    void getEnv
    return { ref, payUrl: `/pay/${ref}` }
  },
  verifyCallback(body: unknown) {
    const b = body as { ref?: string; outcome?: string; sig?: string }
    if (!b?.ref || !b?.outcome || !b?.sig) return null
    const expected = sign(`${b.ref}:${b.outcome}`, callbackSecret())
    const a = Buffer.from(b.sig)
    const c = Buffer.from(expected)
    if (a.length !== c.length || !timingSafeEqual(a, c)) return null
    return {
      ref: b.ref,
      outcome: b.outcome === "succeeded" ? "succeeded" : "failed",
    }
  },
}

import { getEnv } from "@ecommerce/config"

function callbackSecret(): string {
  return getEnv().BETTER_AUTH_SECRET + ":payments"
}

export function signFakeCallback(ref: string, outcome: string): string {
  return sign(`${ref}:${outcome}`, callbackSecret())
}

/** Stripe adapter — only constructed when STRIPE_SECRET_KEY is present. */
export function getStripeProvider(): PaymentProvider | null {
  const env = getEnv()
  if (!env.STRIPE_SECRET_KEY) return null
  // The real SDK import stays lazy so dev never loads it without a key.
  return {
    id: "stripe",
    async createIntent({ ref, amountCents, currency, description }) {
      // optional peer: installed only when PAYMENT_PROVIDER=stripe.
      // Typed loosely — the SDK is an optional dependency.
      // variable specifier: stripe is an optional install, not a compile dep
      const stripeName = "stripe"
      const mod = (await import(/* @vite-ignore */ stripeName)) as {
        default: any
      }
      const stripe = new mod.default(env.STRIPE_SECRET_KEY!)
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: currency.toLowerCase(),
        description,
        metadata: { ref },
        automatic_payment_methods: { enabled: true },
      })
      return { ref, payUrl: intent.id }
    },
    verifyCallback() {
      // Stripe webhook verification requires the raw body + signature header;
      // the route handler validates and then calls this with the parsed event.
      return null
    },
  }
}

export function getProvider(): PaymentProvider {
  const env = getEnv()
  const stripe = getStripeProvider()
  if (env.PAYMENT_PROVIDER === "stripe" && stripe) return stripe
  return fakeProvider
}


