import { createServerFn } from "@tanstack/react-start"

import { z } from "zod"
import { db, schema, and, desc, eq, inArray, sql } from "@ecommerce/db"
import { recomputeProductRating } from "./internals"
import { AppError, guard, requireRole, requireUser } from "./session"

const EDIT_WINDOW_DAYS = 30

/** Verified purchase = user bought this product in a paid/delivered order. */
async function findVerifiedOrderItem(userId: string, productId: string) {
  const [row] = await db
    .select({ id: schema.orderItems.id })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
    .where(
      and(
        eq(schema.orders.buyerId, userId),
        eq(schema.orderItems.productId, productId),
        sql`(
          ${schema.orders.paymentStatus} = 'paid'
          OR ${schema.orders.status} = 'delivered'
        )`,
      ),
    )
    .limit(1)
  return row ?? null
}

const reviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().min(3).max(120),
  body: z.string().min(10).max(2000),
})

// ── public reads ─────────────────────────────────────────────────────────────

export const listReviews = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = input as { productId?: unknown; page?: unknown; sort?: unknown }
    const productId = String(raw.productId ?? "")
    if (!productId) throw new AppError("INVALID", "productId required")
    const page = Math.max(1, Number(raw.page ?? 1))
    const sort = raw.sort === "helpful" ? "helpful" : "newest"
    return { productId, page, sort }
  })
  .handler(({ data }) =>
    guard(async () => {
      const PAGE = 10
      const base = db
        .select({
          id: schema.reviews.id,
          rating: schema.reviews.rating,
          title: schema.reviews.title,
          body: schema.reviews.body,
          helpfulCount: schema.reviews.helpfulCount,
          sellerReply: schema.reviews.sellerReply,
          sellerRepliedAt: schema.reviews.sellerRepliedAt,
          createdAt: schema.reviews.createdAt,
          updatedAt: schema.reviews.updatedAt,
          authorName: schema.users.name,
          userId: schema.reviews.userId,
        })
        .from(schema.reviews)
        .innerJoin(schema.users, eq(schema.reviews.userId, schema.users.id))
        .$dynamic()
      const where = and(
        eq(schema.reviews.productId, data.productId),
        eq(schema.reviews.status, "approved"),
      )
      const rows = await base
        .where(where)
        .orderBy(
          data.sort === "helpful"
            ? desc(schema.reviews.helpfulCount)
            : desc(schema.reviews.createdAt),
        )
        .limit(PAGE)
        .offset((data.page - 1) * PAGE)
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.reviews)
        .where(where)

      const viewer = await requireUser().catch(() => null)
      let myVotes: string[] = []
      if (viewer && rows.length > 0) {
        const votes = await db
          .select({ reviewId: schema.reviewVotes.reviewId })
          .from(schema.reviewVotes)
          .where(
            and(
              eq(schema.reviewVotes.userId, viewer.id),
              inArray(
                schema.reviewVotes.reviewId,
                rows.map((r) => r.id),
              ),
            ),
          )
        myVotes = votes.map((v) => v.reviewId)
      }

      return {
        rows: rows.map((r) => ({
          ...r,
          verifiedPurchase: true, // phase 2 reviews are purchase-only
          edited: r.updatedAt.getTime() - r.createdAt.getTime() > 1000,
          myVote: myVotes.includes(r.id),
        })),
        total,
        page: data.page,
        pageSize: PAGE,
      }
    }),
  )

export const canReview = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const productId = String((input as { productId?: unknown })?.productId ?? "")
    if (!productId) throw new AppError("INVALID", "productId required")
    return { productId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser().catch(() => null)
      if (!user) {
        return { eligible: false, reason: "Sign in and purchase this product to review it" }
      }
      const [existing] = await db
        .select({ id: schema.reviews.id })
        .from(schema.reviews)
        .where(
          and(eq(schema.reviews.productId, data.productId), eq(schema.reviews.userId, user.id)),
        )
        .limit(1)
      if (existing) return { eligible: false, reason: "You already reviewed this product" }
      const item = await findVerifiedOrderItem(user.id, data.productId)
      if (!item) {
        return { eligible: false, reason: "Purchase this product to review it" }
      }
      return { eligible: true, reason: null }
    }),
  )

// ── writes ───────────────────────────────────────────────────────────────────

export const createReview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as Record<string, unknown>
    const productId = String(raw.productId ?? "")
    if (!productId) throw new AppError("INVALID", "productId required")
    return { productId, ...reviewInput.parse(input) }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [existing] = await db
        .select({ id: schema.reviews.id })
        .from(schema.reviews)
        .where(
          and(eq(schema.reviews.productId, data.productId), eq(schema.reviews.userId, user.id)),
        )
        .limit(1)
      if (existing) throw new AppError("TAKEN", "You already reviewed this product")
      const item = await findVerifiedOrderItem(user.id, data.productId)
      if (!item) {
        throw new AppError("FORBIDDEN", "Only verified purchasers can review this product")
      }
      try {
        const review = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(schema.reviews)
            .values({
              productId: data.productId,
              userId: user.id,
              orderItemId: item.id,
              rating: data.rating,
              title: data.title,
              body: data.body,
            })
            .returning()
          await recomputeProductRating(tx, data.productId)
          return row
        })
        return { id: review.id }
      } catch (err) {
        // unique (product, user) → friendly
        if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
          throw new AppError("TAKEN", "You already reviewed this product")
        }
        throw err
      }
    }),
  )

export const updateReview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as Record<string, unknown>
    const reviewId = String(raw.reviewId ?? "")
    if (!reviewId) throw new AppError("INVALID", "reviewId required")
    return { reviewId, ...reviewInput.parse(input) }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [review] = await db
        .select()
        .from(schema.reviews)
        .where(eq(schema.reviews.id, data.reviewId))
        .limit(1)
      if (!review) throw new AppError("NOT_FOUND", "Review not found")
      if (review.userId !== user.id) throw new AppError("FORBIDDEN", "Not your review")
      if (Date.now() - review.createdAt.getTime() > EDIT_WINDOW_DAYS * 24 * 3600 * 1000) {
        throw new AppError("INVALID", "The edit window (30 days) has passed")
      }
      await db.transaction(async (tx) => {
        await tx
          .update(schema.reviews)
          .set({ rating: data.rating, title: data.title, body: data.body })
          .where(eq(schema.reviews.id, data.reviewId))
        await recomputeProductRating(tx, review.productId)
      })
      return { ok: true }
    }),
  )

export const deleteReview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const reviewId = String((input as { reviewId?: unknown })?.reviewId ?? "")
    if (!reviewId) throw new AppError("INVALID", "reviewId required")
    return { reviewId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [review] = await db
        .select()
        .from(schema.reviews)
        .where(eq(schema.reviews.id, data.reviewId))
        .limit(1)
      if (!review) throw new AppError("NOT_FOUND", "Review not found")
      if (review.userId !== user.id && user.role !== "super_admin") {
        throw new AppError("FORBIDDEN", "Not your review")
      }
      await db.transaction(async (tx) => {
        await tx.delete(schema.reviews).where(eq(schema.reviews.id, data.reviewId))
        await recomputeProductRating(tx, review.productId)
      })
      return { deleted: true }
    }),
  )

export const voteReview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const reviewId = String((input as { reviewId?: unknown })?.reviewId ?? "")
    if (!reviewId) throw new AppError("INVALID", "reviewId required")
    return { reviewId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [existing] = await db
        .select({ userId: schema.reviewVotes.userId })
        .from(schema.reviewVotes)
        .where(
          and(eq(schema.reviewVotes.reviewId, data.reviewId), eq(schema.reviewVotes.userId, user.id)),
        )
        .limit(1)
      await db.transaction(async (tx) => {
        if (existing) {
          await tx
            .delete(schema.reviewVotes)
            .where(
              and(
                eq(schema.reviewVotes.reviewId, data.reviewId),
                eq(schema.reviewVotes.userId, user.id),
              ),
            )
          await tx
            .update(schema.reviews)
            .set({ helpfulCount: sql`greatest(${schema.reviews.helpfulCount} - 1, 0)` })
            .where(eq(schema.reviews.id, data.reviewId))
        } else {
          await tx
            .insert(schema.reviewVotes)
            .values({ reviewId: data.reviewId, userId: user.id })
            .onConflictDoNothing()
          await tx
            .update(schema.reviews)
            .set({ helpfulCount: sql`${schema.reviews.helpfulCount} + 1` })
            .where(eq(schema.reviews.id, data.reviewId))
        }
      })
      return { voted: !existing }
    }),
  )

export const replyToReview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { reviewId?: unknown; reply?: unknown }
    const reviewId = String(raw.reviewId ?? "")
    const reply = String(raw.reply ?? "").trim()
    if (!reviewId) throw new AppError("INVALID", "reviewId required")
    if (reply.length < 2 || reply.length > 1000) {
      throw new AppError("INVALID", "Reply must be 2–1000 characters")
    }
    return { reviewId, reply }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [review] = await db
        .select({ productId: schema.reviews.productId })
        .from(schema.reviews)
        .where(eq(schema.reviews.id, data.reviewId))
        .limit(1)
      if (!review) throw new AppError("NOT_FOUND", "Review not found")
      if (user.role !== "super_admin") {
        const [shop] = await db
          .select({ ownerId: schema.shops.ownerId })
          .from(schema.products)
          .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
          .where(eq(schema.products.id, review.productId))
          .limit(1)
        if (!shop || shop.ownerId !== user.id) {
          throw new AppError("FORBIDDEN", "Only the product's seller can reply")
        }
      }
      await db
        .update(schema.reviews)
        .set({ sellerReply: data.reply, sellerRepliedAt: new Date() })
        .where(eq(schema.reviews.id, data.reviewId))
      return { ok: true }
    }),
  )

export const setReviewStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { reviewId?: unknown; status?: unknown }
    const reviewId = String(raw.reviewId ?? "")
    const allowed = ["approved", "hidden"] as const
    const found = allowed.find((s) => s === String(raw.status ?? ""))
    if (!reviewId) throw new AppError("INVALID", "reviewId required")
    if (!found) throw new AppError("INVALID", "Invalid status")
    return { reviewId, status: found }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      const [review] = await db
        .select({ productId: schema.reviews.productId })
        .from(schema.reviews)
        .where(eq(schema.reviews.id, data.reviewId))
        .limit(1)
      if (!review) throw new AppError("NOT_FOUND", "Review not found")
      await db.transaction(async (tx) => {
        await tx
          .update(schema.reviews)
          .set({ status: data.status })
          .where(eq(schema.reviews.id, data.reviewId))
        await recomputeProductRating(tx, review.productId)
      })
      return { ok: true }
    }),
  )

export const adminListReviews = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = input as { status?: unknown; page?: unknown }
    const status = ["approved", "hidden"].includes(String(raw.status))
      ? (String(raw.status) as "approved" | "hidden")
      : undefined
    return { status, page: Math.max(1, Number(raw.page ?? 1)) }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      const PAGE = 20
      const where = data.status ? eq(schema.reviews.status, data.status) : undefined
      const rows = await db
        .select({
          id: schema.reviews.id,
          rating: schema.reviews.rating,
          title: schema.reviews.title,
          status: schema.reviews.status,
          helpfulCount: schema.reviews.helpfulCount,
          createdAt: schema.reviews.createdAt,
          authorName: schema.users.name,
          productTitle: schema.products.title,
        })
        .from(schema.reviews)
        .innerJoin(schema.users, eq(schema.reviews.userId, schema.users.id))
        .innerJoin(schema.products, eq(schema.reviews.productId, schema.products.id))
        .where(where)
        .orderBy(desc(schema.reviews.createdAt))
        .limit(PAGE)
        .offset((data.page - 1) * PAGE)
      const total = await db.$count(schema.reviews, where)
      return { rows, total, page: data.page, pageSize: PAGE }
    }),
  )

// seller scope: reviews of their products
export const listShopReviews = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireRole("seller", "super_admin")
    const [shop] = await db
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(eq(schema.shops.ownerId, user.id))
      .limit(1)
    if (!shop) return []
    const rows = await db
      .select({
        id: schema.reviews.id,
        rating: schema.reviews.rating,
        title: schema.reviews.title,
        body: schema.reviews.body,
        sellerReply: schema.reviews.sellerReply,
        createdAt: schema.reviews.createdAt,
        authorName: schema.users.name,
        productTitle: schema.products.title,
      })
      .from(schema.reviews)
      .innerJoin(schema.users, eq(schema.reviews.userId, schema.users.id))
      .innerJoin(schema.products, eq(schema.reviews.productId, schema.products.id))
      .where(eq(schema.products.shopId, shop.id))
      .orderBy(desc(schema.reviews.createdAt))
      .limit(50)
    return rows
  }),
)
