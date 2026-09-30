import { createServerFn } from "@tanstack/react-start"

import { z } from "zod"
import { db, schema, and, asc, eq, sql } from "@ecommerce/db"
import { recomputeProductAggregates } from "./internals"
import { AppError, guard, requireRole, requireUser } from "./session"

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  )
}

/**
 * Plan-5: variants are the source of truth for price/stock once a product
 * has them; products.price_cents/stock become derived aggregates maintained
 * in the same transaction as every variant write.
 */
/** Product + ownership load shared by the mutations. */
async function productWithOwner(productId: string) {
  const [row] = await db
    .select({
      id: schema.products.id,
      ownerId: schema.shops.ownerId,
      title: schema.products.title,
      productTypeId: schema.products.productTypeId,
      status: schema.products.status,
    })
    .from(schema.products)
    .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
    .where(eq(schema.products.id, productId))
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Product not found")
  return row
}

function assertCanManage(user: { id: string; role: string }, ownerId: string) {
  if (user.role !== "super_admin" && user.id !== ownerId) {
    throw new AppError("FORBIDDEN", "You can only manage your own products")
  }
}

// ── reads ────────────────────────────────────────────────────────────────────

export const listVariants = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const productId = String((input as { productId?: unknown })?.productId ?? "")
    if (!productId) throw new AppError("INVALID", "productId required")
    return { productId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const rows = await db
        .select({
          id: schema.productVariants.id,
          productId: schema.productVariants.productId,
          sku: schema.productVariants.sku,
          title: schema.productVariants.title,
          priceCents: schema.productVariants.priceCents,
          stock: schema.productVariants.stock,
          weightGrams: schema.productVariants.weightGrams,
          imageId: schema.productVariants.imageId,
          isDefault: schema.productVariants.isDefault,
          status: schema.productVariants.status,
          position: schema.productVariants.position,
          options: sql<
            { attributeId: string; value: string }[]
          >`coalesce((
            select json_agg(json_build_object('attributeId', vov.attribute_id, 'value', vov.value) order by vov.attribute_id)
            from variant_option_values vov where vov.variant_id = ${schema.productVariants.id}
          ), '[]'::json)`,
        })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.productId, data.productId))
        .orderBy(asc(schema.productVariants.position), asc(schema.productVariants.id))
      // public reads only expose active variants; owners/admins see all
      const user = await requireUser().catch(() => null)
      if (rows.some((r) => r.status !== "active")) {
        const [owner] = await db
          .select({ ownerId: schema.shops.ownerId })
          .from(schema.products)
          .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
          .where(eq(schema.products.id, data.productId))
          .limit(1)
        const isOwner =
          user && (user.role === "super_admin" || user.id === owner?.ownerId)
        if (!isOwner) {
          return rows.filter((r) => r.status === "active")
        }
      }
      return rows
    }),
  )

// ── generation from variant axes ─────────────────────────────────────────────

export const generateVariants = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const productId = String((input as { productId?: unknown })?.productId ?? "")
    if (!productId) throw new AppError("INVALID", "productId required")
    return { productId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const product = await productWithOwner(data.productId)
      assertCanManage(user, product.ownerId)
      if (!product.productTypeId) {
        throw new AppError("INVALID", "Assign a product type with variant axes first")
      }

      const axes = await db
        .select()
        .from(schema.attributeDefinitions)
        .where(
          and(
            eq(schema.attributeDefinitions.productTypeId, product.productTypeId),
            eq(schema.attributeDefinitions.useForVariants, true),
          ),
        )
        .orderBy(asc(schema.attributeDefinitions.position))
      if (axes.length === 0) {
        throw new AppError(
          "INVALID",
          "This product's type has no variant-axis attributes — add one in Admin → Types",
        )
      }
      if (axes.length > 3) {
        throw new AppError("INVALID", "Max 3 variant axes per type")
      }
      for (const axis of axes) {
        if (axis.options.length === 0) {
          throw new AppError("INVALID", `Axis "${axis.name}" has no options`)
        }
      }

      const existing = await db
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.productId, data.productId))

      // existing combinations → skip duplicates
      const existingValues = await db
        .select({
          variantId: schema.variantOptionValues.variantId,
          attributeId: schema.variantOptionValues.attributeId,
          value: schema.variantOptionValues.value,
        })
        .from(schema.variantOptionValues)
        .innerJoin(
          schema.productVariants,
          eq(schema.variantOptionValues.variantId, schema.productVariants.id),
        )
        .where(eq(schema.productVariants.productId, data.productId))
      // one combination key per existing variant (M2: joining every value
      // into a single string made the Set hold characters, so nothing ever
      // matched and re-running generate duplicated variants)
      const optionsByVariant = new Map<string, string[]>()
      for (const v of existingValues) {
        const list = optionsByVariant.get(v.variantId) ?? []
        list.push(`${v.attributeId}:${v.value}`)
        optionsByVariant.set(v.variantId, list)
      }
      const combos = new Set(
        [...optionsByVariant.values()].map((opts) => opts.sort().join("|")),
      )

      // cartesian product over axes (in attribute order)
      let combosToCreate: { attributeId: string; value: string }[][] = [[]]
      for (const axis of axes) {
        const next: { attributeId: string; value: string }[][] = []
        for (const partial of combosToCreate) {
          for (const option of axis.options) {
            next.push([...partial, { attributeId: axis.id, value: option }])
          }
        }
        combosToCreate = next
      }
      const toInsert = combosToCreate.filter(
        (combo) => !combos.has(combo.map((c) => `${c.attributeId}:${c.value}`).sort().join("|")),
      )
      if (toInsert.length === 0) {
        throw new AppError("INVALID", "All combinations already exist")
      }

      const [prodMeta] = await db
        .select({ priceCents: schema.products.priceCents, weightGrams: schema.products.weightGrams })
        .from(schema.products)
        .where(eq(schema.products.id, data.productId))
        .limit(1)

      const created = await db.transaction(async (tx) => {
        const basePos = existing.length
        const inserted: { id: string; title: string }[] = []
        for (const [i, combo] of toInsert.entries()) {
          const title = combo.map((c) => c.value).join(" / ")
          const [variant] = await tx
            .insert(schema.productVariants)
            .values({
              productId: data.productId,
              sku: `V-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
              title,
              priceCents: prodMeta?.priceCents ?? 0,
              stock: 0,
              weightGrams: prodMeta?.weightGrams ?? null,
              // the first generated variant becomes default when starting empty
              isDefault: existing.length === 0 && i === 0,
              status: "draft",
              position: basePos + i,
            })
            .returning({ id: schema.productVariants.id, title: schema.productVariants.title })
          await tx.insert(schema.variantOptionValues).values(
            combo.map((c) => ({ variantId: variant.id, attributeId: c.attributeId, value: c.value })),
          )
          inserted.push(variant)
        }
        await recomputeProductAggregates(tx, data.productId)
        return inserted
      })
      return { created: created.length, variants: created }
    }),
  )

// ── single-variant upsert ────────────────────────────────────────────────────

const variantInput = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  title: z.string().min(1).max(120),
  sku: z.string().regex(/^[A-Za-z0-9-]{3,40}$/, "SKU: 3–40 letters, digits, dashes"),
  priceCents: z.number().int().min(1),
  stock: z.number().int().min(0),
  weightGrams: z.number().int().min(0).nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).default("active"),
  options: z
    .array(z.object({ attributeId: z.string(), value: z.string().min(1) }))
    .max(3)
    .default([]),
})

export const upsertVariant = createServerFn({ method: "POST" })
  .validator((input: unknown) => variantInput.parse(input))
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const product = await productWithOwner(data.productId)
      assertCanManage(user, product.ownerId)

      // options must belong to the type's variant axes and be valid options
      if (product.productTypeId && data.options.length > 0) {
        const axes = await db
          .select()
          .from(schema.attributeDefinitions)
          .where(
            and(
              eq(schema.attributeDefinitions.productTypeId, product.productTypeId),
              eq(schema.attributeDefinitions.useForVariants, true),
            ),
          )
        const axesById = new Map(axes.map((a) => [a.id, a]))
        const seen = new Set<string>()
        for (const opt of data.options) {
          const axis = axesById.get(opt.attributeId)
          if (!axis) {
            throw new AppError("INVALID", "Option does not match a variant axis of this type")
          }
          if (!axis.options.includes(opt.value)) {
            throw new AppError("INVALID", `"${opt.value}" is not an option of "${axis.name}"`)
          }
          if (seen.has(opt.attributeId)) {
            throw new AppError("INVALID", "Duplicate option axis")
          }
          seen.add(opt.attributeId)
        }
        if (seen.size !== axes.length && data.options.length !== axes.length) {
          throw new AppError(
            "INVALID",
            `All ${axes.length} axes must have values for this variant`,
          )
        }
      }

      try {
        const result = await db.transaction(async (tx) => {
          let variantId: string
          if (data.variantId) {
            const [updated] = await tx
              .update(schema.productVariants)
              .set({
                title: data.title,
                sku: data.sku,
                priceCents: data.priceCents,
                stock: data.stock,
                weightGrams: data.weightGrams ?? null,
                status: data.status,
              })
              .where(
                and(
                  eq(schema.productVariants.id, data.variantId),
                  eq(schema.productVariants.productId, data.productId),
                ),
              )
              .returning({ id: schema.productVariants.id })
            if (!updated) throw new AppError("NOT_FOUND", "Variant not found")
            variantId = updated.id
            if (data.options.length > 0) {
              await tx
                .delete(schema.variantOptionValues)
                .where(eq(schema.variantOptionValues.variantId, variantId))
            }
          } else {
            const count = await db.$count(
              schema.productVariants,
              eq(schema.productVariants.productId, data.productId),
            )
            const [created] = await tx
              .insert(schema.productVariants)
              .values({
                productId: data.productId,
                sku: data.sku,
                title: data.title,
                priceCents: data.priceCents,
                stock: data.stock,
                weightGrams: data.weightGrams ?? null,
                status: data.status,
                isDefault: count === 0,
                position: count,
              })
              .returning({ id: schema.productVariants.id })
            variantId = created.id
          }
          if (data.options.length > 0) {
            await tx.insert(schema.variantOptionValues).values(
              data.options.map((o) => ({
                variantId,
                attributeId: o.attributeId,
                value: o.value,
              })),
            )
          }
          await recomputeProductAggregates(tx, data.productId)
          return variantId
        })
        return { id: result }
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError("TAKEN", "That SKU is already in use")
        }
        throw err
      }
    }),
  )

export const deleteVariant = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const variantId = String((input as { variantId?: unknown })?.variantId ?? "")
    if (!variantId) throw new AppError("INVALID", "variantId required")
    return { variantId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [variant] = await db
        .select({
          id: schema.productVariants.id,
          productId: schema.productVariants.productId,
          ownerId: schema.shops.ownerId,
        })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.productVariants.id, data.variantId))
        .limit(1)
      if (!variant) throw new AppError("NOT_FOUND", "Variant not found")
      assertCanManage(user, variant.ownerId)

      const referenced = await db.$count(
        schema.orderItems,
        eq(schema.orderItems.variantId, data.variantId),
      )
      if (referenced > 0) {
        // referenced by orders → archive instead of delete
        await db
          .update(schema.productVariants)
          .set({ status: "archived", stock: 0 })
          .where(eq(schema.productVariants.id, data.variantId))
        await db.transaction(async (tx) => {
          await recomputeProductAggregates(tx, variant.productId)
        })
        return { archived: true }
      }

      const total = await db.$count(
        schema.productVariants,
        eq(schema.productVariants.productId, variant.productId),
      )
      if (total <= 1) {
        throw new AppError("INVALID", "A product must keep at least one variant")
      }
      await db
        .delete(schema.productVariants)
        .where(eq(schema.productVariants.id, data.variantId))
      await db.transaction(async (tx) => {
        await recomputeProductAggregates(tx, variant.productId)
      })
      return { deleted: true }
    }),
  )

export const setDefaultVariant = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { productId?: unknown; variantId?: unknown }
    const productId = String(raw.productId ?? "")
    const variantId = String(raw.variantId ?? "")
    if (!productId || !variantId) throw new AppError("INVALID", "productId and variantId required")
    return { productId, variantId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const product = await productWithOwner(data.productId)
      assertCanManage(user, product.ownerId)
      // L4: choosing a default no longer silently re-activates an archived
      // variant — its status stays the seller's decision
      const [target] = await db
        .select({ status: schema.productVariants.status })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.id, data.variantId),
            eq(schema.productVariants.productId, data.productId),
          ),
        )
        .limit(1)
      if (!target) throw new AppError("NOT_FOUND", "Variant not found")
      if (target.status === "archived") {
        throw new AppError("INVALID", "Restore this variant before making it the default")
      }
      await db.transaction(async (tx) => {
        await tx
          .update(schema.productVariants)
          .set({ isDefault: false })
          .where(eq(schema.productVariants.productId, data.productId))
        await tx
          .update(schema.productVariants)
          .set({ isDefault: true })
          .where(eq(schema.productVariants.id, data.variantId))
      })
      return { ok: true }
    }),
  )

export const assignVariantImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { variantId?: unknown; imageId?: unknown }
    const variantId = String(raw.variantId ?? "")
    const imageId = String(raw.imageId ?? "")
    if (!variantId || !imageId) throw new AppError("INVALID", "variantId and imageId required")
    return { variantId, imageId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [variant] = await db
        .select({ productId: schema.productVariants.productId, ownerId: schema.shops.ownerId })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.productVariants.id, data.variantId))
        .limit(1)
      if (!variant) throw new AppError("NOT_FOUND", "Variant not found")
      assertCanManage(user, variant.ownerId)
      // L3: only an image of the variant's own product
      const [image] = await db
        .select({ id: schema.productImages.id })
        .from(schema.productImages)
        .where(
          and(
            eq(schema.productImages.id, data.imageId),
            eq(schema.productImages.productId, variant.productId),
          ),
        )
        .limit(1)
      if (!image) throw new AppError("NOT_FOUND", "Image not found on this product")
      await db
        .update(schema.productVariants)
        .set({ imageId: data.imageId })
        .where(eq(schema.productVariants.id, data.variantId))
      return { ok: true }
    }),
  )
