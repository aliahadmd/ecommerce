import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { db, schema, eq, isNotNull, desc, sql } from "@ecommerce/db"
import { AppError, guard, requireRole, requireUser } from "./session"

// ── settings (admin) ─────────────────────────────────────────────────────────

const SETTINGS_KEY = "store.settings"

export interface StoreSettings {
  mode: "open" | "maintenance"
  signupsEnabled: boolean
  commissionRate: number // percent 0–50
  contactEmail: string
}

const DEFAULTS: StoreSettings = {
  mode: "open",
  signupsEnabled: true,
  commissionRate: 10,
  contactEmail: "support@dev.local",
}

const settingsSchema = z.object({
  mode: z.enum(["open", "maintenance"]),
  signupsEnabled: z.boolean(),
  commissionRate: z.number().int().min(0).max(50),
  contactEmail: z.string().email(),
})

export const getStoreSettings = createServerFn({ method: "GET" }).handler(
  () =>
    guard(async () => {
      const [row] = await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, SETTINGS_KEY))
        .limit(1)
      if (!row) return DEFAULTS
      const parsed = settingsSchema.safeParse(row.value)
      return parsed.success ? parsed.data : DEFAULTS
    })
)

export const updateStoreSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const parsed = settingsSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppError("INVALID", "Invalid settings values")
    }
    return parsed.data
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await db
        .insert(schema.settings)
        .values({ key: SETTINGS_KEY, value: data })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: data, updatedAt: new Date() },
        })
      void getStoreSettings
      return { ok: true }
    })
  )

// ── review photos (author-only, max 3) ──────────────────────────────────────

export const uploadReviewPhoto = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as FormData)
  .handler(({ data }: { data: FormData }) =>
    guard(async () => {
      const user = await requireUser()
      const reviewId = String(data.get("reviewId") ?? "")
      const file = data.get("file")
      if (!(file instanceof File)) throw new AppError("INVALID", "No file")
      if (!isAllowedImageMime(file.type)) {
        throw new AppError("INVALID", "Only JPEG, PNG or WebP images are allowed")
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new AppError("INVALID", "Image must be 5MB or smaller")
      }
      const [review] = await db
        .select({ photos: schema.reviews.photos, userId: schema.reviews.userId })
        .from(schema.reviews)
        .where(eq(schema.reviews.id, reviewId))
        .limit(1)
      if (!review) throw new AppError("NOT_FOUND", "Review not found")
      if (review.userId !== user.id) {
        throw new AppError("FORBIDDEN", "Not your review")
      }
      const photos = (review.photos ?? []) as { key: string; url: string }[]
      if (photos.length >= 3) {
        throw new AppError("INVALID", "Max 3 photos per review")
      }

      const { uploadImage, publicUrl } = await import("@ecommerce/storage")
      const key = `reviews/${reviewId}/${crypto.randomUUID()}.${
        file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"
      }`
      await uploadImage(key, new Uint8Array(await file.arrayBuffer()), file.type)
      const url = publicUrl(key)
      const next = [...photos, { key, url }]
      await db
        .update(schema.reviews)
        .set({ photos: next })
        .where(eq(schema.reviews.id, reviewId))
      return { url }
    })
  )

// ── abuse reporting ──────────────────────────────────────────────────────────

export const reportReview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { reviewId?: unknown; reason?: unknown }
    const reviewId = String(raw.reviewId ?? "")
    const reason = String(raw.reason ?? "").trim()
    if (!reviewId) throw new AppError("INVALID", "reviewId required")
    if (reason.length < 5 || reason.length > 300) {
      throw new AppError("INVALID", "Reason must be 5–300 characters")
    }
    return { reviewId, reason }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      try {
        await db.transaction(async (tx) => {
          await tx
            .insert(schema.reviewReports)
            .values({ reviewId: data.reviewId, userId: user.id, reason: data.reason })
          await tx
            .update(schema.reviews)
            .set({ reportedAt: new Date() })
            .where(eq(schema.reviews.id, data.reviewId))
        })
        return { ok: true }
      } catch (err) {
        if (
          typeof err === "object" && err !== null && "code" in err &&
          (err as { code?: string }).code === "23505"
        ) {
          throw new AppError("TAKEN", "You already reported this review")
        }
        throw err
      }
    })
  )

export const dismissReviewReport = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const reviewId = String((input as { reviewId?: unknown })?.reviewId ?? "")
    if (!reviewId) throw new AppError("INVALID", "reviewId required")
    return { reviewId }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.reviewReports)
          .where(eq(schema.reviewReports.reviewId, data.reviewId))
        await tx
          .update(schema.reviews)
          .set({ reportedAt: null })
          .where(eq(schema.reviews.id, data.reviewId))
      })
      return { ok: true }
    })
  )

export const listReportedReviews = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("super_admin")
    const rows = await db
      .select({
        reviewId: schema.reviews.id,
        title: schema.reviews.title,
        body: schema.reviews.body,
        rating: schema.reviews.rating,
        createdAt: schema.reviews.createdAt,
        reports: sql<number>`(select count(*)::int from review_reports rr where rr.review_id = ${schema.reviews.id})`,
      })
      .from(schema.reviews)
      .where(isNotNull(schema.reviews.reportedAt))
      .orderBy(desc(schema.reviews.reportedAt))
      .limit(50)
    return rows
  })
)

function isAllowedImageMime(mime: string): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(mime)
}
void requireRole
