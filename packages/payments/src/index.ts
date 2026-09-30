/**
 * PaymentProvider abstraction (plan-3). Stripe specifics never leak past
 * this interface; the fake provider is the dev/test default.
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import { getEnv } from "@ecommerce/config"

export interface PaymentIntent {
  ref: string
  /** Local page for the fake gateway; hosted Stripe Checkout URL for stripe. */
  payUrl: string
}

export type PaymentOutcome = "succeeded" | "failed"

export interface VerifiedEvent {
  ref: string
  outcome: PaymentOutcome
  /** provider event id — stored in payment_events for idempotent replays */
  eventId: string
}

export interface PaymentProvider {
  readonly id: "fake" | "stripe"
  createIntent(input: {
    ref: string
    amountCents: number
    currency: string
    description: string
  }): Promise<PaymentIntent>
  /**
   * Verify a gateway callback/webhook from its raw body + headers. Returns
   * null when the signature is invalid or the event is irrelevant.
   */
  verifyWebhook(input: { rawBody: string; headers: Headers }): Promise<VerifiedEvent | null>
  /** Return `amountCents` of a captured payment to the buyer. */
  refund(input: { providerRef: string; amountCents: number }): Promise<void>
}

// ── fake gateway (dev/test) ──────────────────────────────────────────────────

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex")
}

function callbackSecret(): string {
  // L14: a dedicated secret when configured; the derived fallback keeps dev
  // zero-config
  const env = getEnv()
  return env.PAYMENT_CALLBACK_SECRET || env.BETTER_AUTH_SECRET + ":payments"
}

export function signFakeCallback(ref: string, outcome: string): string {
  return sign(`${ref}:${outcome}`, callbackSecret())
}

/** Fake gateway: payUrl is a local page; callbacks are HMAC-signed JSON. */
export const fakeProvider: PaymentProvider = {
  id: "fake",
  async createIntent({ ref }) {
    return { ref, payUrl: `/pay/${ref}` }
  },
  async verifyWebhook({ rawBody }) {
    let b: { ref?: unknown; outcome?: unknown; sig?: unknown }
    try {
      b = JSON.parse(rawBody) as typeof b
    } catch {
      return null
    }
    if (typeof b.ref !== "string" || typeof b.outcome !== "string" || typeof b.sig !== "string") {
      return null
    }
    const expected = Buffer.from(sign(`${b.ref}:${b.outcome}`, callbackSecret()))
    const given = Buffer.from(b.sig)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    return {
      ref: b.ref,
      outcome: b.outcome === "succeeded" ? "succeeded" : "failed",
      // the fake gateway has no event ids; one settle per ref+outcome
      eventId: `fake:${b.ref}:${b.outcome}`,
    }
  },
  async refund() {
    // nothing captured for real — the payments row carries the bookkeeping
  },
}

// ── Stripe (hosted Checkout + signed webhooks) ───────────────────────────────

type StripeClient = any

let stripeClient: StripeClient | null = null

async function stripe(): Promise<StripeClient> {
  if (stripeClient) return stripeClient
  // optional dependency: installed only when PAYMENT_PROVIDER=stripe, so the
  // specifier is a variable (never bundled or type-resolved in dev)
  const name = "stripe"
  const mod = (await import(/* @vite-ignore */ name)) as { default: new (key: string) => StripeClient }
  stripeClient = new mod.default(getEnv().STRIPE_SECRET_KEY)
  return stripeClient
}

function stripeProvider(): PaymentProvider {
  return {
    id: "stripe",
    async createIntent({ ref, amountCents, currency, description }) {
      const base = getEnv().BETTER_AUTH_URL.replace(/\/$/, "")
      const session = await (await stripe()).checkout.sessions.create({
        mode: "payment",
        client_reference_id: ref,
        metadata: { ref },
        payment_intent_data: { metadata: { ref } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: amountCents,
              product_data: { name: description },
            },
          },
        ],
        success_url: `${base}/account/orders?payment=success`,
        cancel_url: `${base}/account/orders?payment=cancelled`,
      })
      return { ref, payUrl: session.url as string }
    },
    async verifyWebhook({ rawBody, headers }) {
      const secret = getEnv().STRIPE_WEBHOOK_SECRET
      const signature = headers.get("stripe-signature")
      if (!secret || !signature) return null
      let event: { id: string; type: string; data: { object: Record<string, any> } }
      try {
        event = (await stripe()).webhooks.constructEvent(rawBody, signature, secret)
      } catch {
        return null
      }
      const obj = event.data.object
      const ref = (obj.metadata?.ref ?? obj.client_reference_id) as string | undefined
      if (!ref) return null
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        if (obj.payment_status !== "paid") return null
        return { ref, outcome: "succeeded", eventId: event.id }
      }
      if (
        event.type === "checkout.session.expired" ||
        event.type === "checkout.session.async_payment_failed"
      ) {
        return { ref, outcome: "failed", eventId: event.id }
      }
      return null
    },
    async refund({ providerRef, amountCents }) {
      const client = await stripe()
      const found = await client.paymentIntents.search({
        query: `metadata['ref']:'${providerRef.replace(/'/g, "")}'`,
        limit: 1,
      })
      const intent = found.data?.[0]
      if (!intent) throw new Error(`No Stripe PaymentIntent for ref ${providerRef}`)
      await client.refunds.create({ payment_intent: intent.id, amount: amountCents })
    },
  }
}

/** The configured provider. Stripe requires STRIPE_SECRET_KEY. */
export function getProvider(): PaymentProvider {
  const env = getEnv()
  if (env.PAYMENT_PROVIDER === "stripe") {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY")
    }
    return stripeProvider()
  }
  return fakeProvider
}

/** True when the local fake gateway (/pay/$ref) is the active provider. */
export function isFakeGateway(): boolean {
  return getEnv().PAYMENT_PROVIDER === "fake"
}
