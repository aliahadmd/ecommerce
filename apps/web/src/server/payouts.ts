import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, desc, eq, sql } from "@ecommerce/db"
import { cachedJson } from "@ecommerce/redis"
import { AppError, guard, requireRole } from "./session"

const DEFAULT_COMMISSION_PERCENT = 10

/**
 * Read the commission percent from settings (cached 30s, default 10%).
 * The uncached twin used inside ledger transactions lives in payouts-internals.
 */
export async function getCommissionPercent(): Promise<number> {
  try {
    return await cachedJson("settings:commission", 30, async () => {
      const [row] = await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, "commerce.commission_rate"))
        .limit(1)
      const v = row?.value
      return typeof v === "number" && v >= 0 && v <= 50 ? v : DEFAULT_COMMISSION_PERCENT
    })
  } catch {
    return DEFAULT_COMMISSION_PERCENT
  }
}

/**
 * Create the `sale` ledger entry for a delivered sub-order. Idempotent:
 * one sale entry per sub-order (checked in-tx).
 * `tx` must be the caller's transaction.
 */
export async function ledgerSaleForSubOrder(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  subOrderId: string
): Promise<void> {
  const [existing] = await tx
    .select({ id: schema.sellerLedger.id })
    .from(schema.sellerLedger)
    .where(
      and(
        eq(schema.sellerLedger.subOrderId, subOrderId),
        eq(schema.sellerLedger.kind, "sale")
      )
    )
    .limit(1)
  if (existing) return

  const [sub] = await tx
    .select()
    .from(schema.subOrders)
    .where(eq(schema.subOrders.id, subOrderId))
    .limit(1)
  if (!sub) return

  const percent = await getCommissionPercent()
  const gross = sub.totalCents - sub.discountCents
  const commission = Math.round((gross * percent) / 100)
  await tx.insert(schema.sellerLedger).values({
    shopId: sub.shopId,
    subOrderId: sub.id,
    orderId: sub.orderId,
    kind: "sale",
    grossCents: gross,
    commissionCents: commission,
    netCents: gross - commission,
    memo: null,
  })
}

/** Balancing refund entry (gross=refunded, net=-(refunded-commission)). */
export async function ledgerRefundForSubOrder(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  subOrderId: string,
  refundCents: number
): Promise<void> {
  const percent = await getCommissionPercent()
  const commission = Math.round((refundCents * percent) / 100)
  const [sub] = await tx
    .select({ shopId: schema.subOrders.shopId, orderId: schema.subOrders.orderId })
    .from(schema.subOrders)
    .where(eq(schema.subOrders.id, subOrderId))
    .limit(1)
  if (!sub) return
  await tx.insert(schema.sellerLedger).values({
    shopId: sub.shopId,
    subOrderId,
    orderId: sub.orderId,
    kind: "refund",
    grossCents: refundCents,
    commissionCents: commission,
    netCents: -(refundCents - commission),
    memo: "refund",
  })
}

// ── seller reads ─────────────────────────────────────────────────────────────

export const getSellerBalance = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireRole("seller", "super_admin")
    const [shop] = await db
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(eq(schema.shops.ownerId, user.id))
      .limit(1)
    if (!shop) throw new AppError("FORBIDDEN", "Create your shop first")
    const [row] = await db
      .select({
        earned: sql<number>`coalesce(sum(CASE WHEN kind IN ('sale','adjustment') THEN net_cents ELSE 0 END),0)::int`,
        refunded: sql<number>`coalesce(sum(CASE WHEN kind = 'refund' THEN -net_cents ELSE 0 END),0)::int`,
        paidOut: sql<number>`coalesce(sum(CASE WHEN kind = 'payout' THEN -net_cents ELSE 0 END),0)::int`,
      })
      .from(schema.sellerLedger)
      .where(eq(schema.sellerLedger.shopId, shop.id))
    return {
      available: (row?.earned ?? 0) - (row?.refunded ?? 0) - (row?.paidOut ?? 0),
      lifetimeEarned: row?.earned ?? 0,
      paidOut: row?.paidOut ?? 0,
    }
  })
)

export const getSellerStatement = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireRole("seller", "super_admin")
    const [shop] = await db
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(eq(schema.shops.ownerId, user.id))
      .limit(1)
    if (!shop) throw new AppError("FORBIDDEN", "Create your shop first")
    const rows = await db
      .select()
      .from(schema.sellerLedger)
      .where(eq(schema.sellerLedger.shopId, shop.id))
      .orderBy(desc(schema.sellerLedger.createdAt))
      .limit(200)
    const history = await db
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.shopId, shop.id))
      .orderBy(desc(schema.payouts.createdAt))
      .limit(50)
    return { entries: rows, payouts: history }
  })
)

// ── admin ────────────────────────────────────────────────────────────────────

export const getPayoutOverview = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("super_admin")
    const shops = await db
      .select({
        shopId: schema.shops.id,
        shopName: schema.shops.name,
        earned: sql<number>`coalesce(sum(CASE WHEN l.kind IN ('sale','adjustment') THEN l.net_cents ELSE 0 END),0)::int`,
        refunded: sql<number>`coalesce(sum(CASE WHEN l.kind = 'refund' THEN -l.net_cents ELSE 0 END),0)::int`,
        paidOut: sql<number>`coalesce((select coalesce(sum(-pl.net_cents),0) from seller_ledger pl where pl.shop_id = ${schema.shops.id} and pl.kind = 'payout'),0)::int`,
      })
      .from(schema.shops)
      .leftJoin(sql`seller_ledger l`, sql`l.shop_id = ${schema.shops.id}`)
      .groupBy(schema.shops.id, schema.shops.name)
    return shops.map((s) => ({
      ...s,
      available: s.earned - s.refunded - s.paidOut,
    }))
  })
)

export const createPayout = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { shopId?: unknown; amountCents?: unknown; memo?: unknown }
    const shopId = String(raw.shopId ?? "")
    const amountCents = Number(raw.amountCents ?? 0)
    if (!shopId) throw new AppError("INVALID", "shopId required")
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new AppError("INVALID", "Payout must be a positive amount")
    }
    return {
      shopId,
      amountCents,
      memo: raw.memo ? String(raw.memo).slice(0, 300) : null,
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      const admin = await requireRole("super_admin")
      await db.transaction(async (tx) => {
        const [available] = await tx
          .select({
            net: sql<number>`coalesce(sum(net_cents),0)::int`,
          })
          .from(schema.sellerLedger)
          .where(eq(schema.sellerLedger.shopId, data.shopId))
        if ((available?.net ?? 0) < data.amountCents) {
          throw new AppError("INVALID", "Payout exceeds the shop's available balance")
        }
        const [payout] = await tx
          .insert(schema.payouts)
          .values({
            shopId: data.shopId,
            amountCents: data.amountCents,
            memo: data.memo,
            createdBy: admin.id,
          })
          .returning({ id: schema.payouts.id })
        await tx.insert(schema.sellerLedger).values({
          shopId: data.shopId,
          kind: "payout",
          grossCents: data.amountCents,
          commissionCents: 0,
          netCents: -data.amountCents,
          memo: `Payout ${payout.id}`,
        })
      })
      return { ok: true }
    }),
  )

export const listPayouts = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("super_admin")
    return db
      .select({
        id: schema.payouts.id,
        shopName: schema.shops.name,
        amountCents: schema.payouts.amountCents,
        memo: schema.payouts.memo,
        createdAt: schema.payouts.createdAt,
      })
      .from(schema.payouts)
      .innerJoin(schema.shops, eq(schema.payouts.shopId, schema.shops.id))
      .orderBy(desc(schema.payouts.createdAt))
      .limit(100)
  })
)
