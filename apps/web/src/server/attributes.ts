import { createServerFn } from "@tanstack/react-start"

import { z } from "zod"
import { db, schema, and, asc, eq, inArray, sql } from "@ecommerce/db"
import type { AttributeValue } from "@ecommerce/db"
import { slugify, slugWithSuffix } from "@ecommerce/config"
import { AppError, guard, requireRole, requireUser } from "./session"
import { isUniqueViolation } from "./catalog"

// ── value validation against a definition ────────────────────────────────────

export type AttributeKind = "text" | "number" | "boolean" | "select" | "multiselect"

const kindValidators: Record<AttributeKind, z.ZodType<unknown>> = {
  text: z.string().max(500),
  number: z.number(),
  boolean: z.boolean(),
  select: z.string().max(200),
  multiselect: z.array(z.string().max(200)).max(20),
} as const

export function validateAttributeValue(
  def: { kind: AttributeKind; options: string[]; name: string },
  value: unknown,
): AttributeValue {
  const parser = kindValidators[def.kind]
  const parsed = parser.safeParse(value)
  if (!parsed.success) {
    throw new AppError("INVALID", `Invalid value for "${def.name}" (${def.kind})`)
  }
  if ((def.kind === "select" || def.kind === "multiselect") && def.options.length > 0) {
    const values = def.kind === "select" ? [parsed.data as string] : (parsed.data as string[])
    for (const v of values) {
      if (!def.options.includes(v)) {
        throw new AppError("INVALID", `"${v}" is not a valid option for "${def.name}"`)
      }
    }
  }
  return parsed.data as AttributeValue
}

// ── admin: types ─────────────────────────────────────────────────────────────

export const listProductTypes = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("super_admin")
    const types = await db
      .select({
        id: schema.productTypes.id,
        name: schema.productTypes.name,
        slug: schema.productTypes.slug,
        productCount: sql<number>`(select count(*)::int from products p where p.product_type_id = ${schema.productTypes.id})`,
      })
      .from(schema.productTypes)
      .orderBy(asc(schema.productTypes.name))
    const defs = await db
      .select()
      .from(schema.attributeDefinitions)
      .orderBy(asc(schema.attributeDefinitions.position), asc(schema.attributeDefinitions.name))
    return { types, definitions: defs }
  }),
)

const typeInput = (input: unknown) => {
  const name = String((input as { name?: unknown })?.name ?? "").trim()
  if (name.length < 2 || name.length > 60) {
    throw new AppError("INVALID", "Type name must be 2–60 characters")
  }
  return { name }
}

export const createProductType = createServerFn({ method: "POST" })
  .validator(typeInput)
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      let slug = slugify(data.name)
      const [taken] = await db
        .select({ id: schema.productTypes.id })
        .from(schema.productTypes)
        .where(eq(schema.productTypes.slug, slug))
        .limit(1)
      if (taken) slug = slugWithSuffix(slug)
      try {
        const [row] = await db
          .insert(schema.productTypes)
          .values({ name: data.name, slug })
          .returning()
        return row
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError("TAKEN", "That type name is taken")
        throw err
      }
    }),
  )

export const updateProductType = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { id?: unknown; name?: unknown }
    const id = String(raw.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id, ...typeInput(input) }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      const [row] = await db
        .update(schema.productTypes)
        .set({ name: data.name })
        .where(eq(schema.productTypes.id, data.id))
        .returning()
      if (!row) throw new AppError("NOT_FOUND", "Type not found")
      return row
    }),
  )

export const deleteProductType = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      const inUse = await db.$count(schema.products, eq(schema.products.productTypeId, data.id))
      if (inUse > 0) {
        throw new AppError(
          "IN_USE",
          `${inUse} product(s) use this type — reassign them first`,
        )
      }
      await db.delete(schema.productTypes).where(eq(schema.productTypes.id, data.id))
      return { deleted: true }
    }),
  )

// ── admin: attribute definitions ─────────────────────────────────────────────

const attributeInput = (input: unknown) => {
  const raw = input as Record<string, unknown>
  const name = String(raw.name ?? "").trim()
  if (name.length < 2 || name.length > 60) {
    throw new AppError("INVALID", "Attribute name must be 2–60 characters")
  }
  const kind = String(raw.kind ?? "text")
  if (!(kind in kindValidators)) throw new AppError("INVALID", "Invalid attribute kind")
  const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o).trim()).filter(Boolean) : []
  if ((kind === "select" || kind === "multiselect") && options.length < 2) {
    throw new AppError("INVALID", "Select attributes need at least 2 options")
  }
  const useForVariants = Boolean(raw.useForVariants)
  if (useForVariants && kind !== "select") {
    throw new AppError("INVALID", "Variant axes must be select attributes")
  }
  return {
    name,
    kind: kind as AttributeKind,
    options,
    unit: raw.unit ? String(raw.unit).trim().slice(0, 20) : null,
    required: Boolean(raw.required),
    useForVariants,
    filterable: Boolean(raw.filterable),
    productTypeId: raw.productTypeId ? String(raw.productTypeId) : null,
  }
}

export const createAttribute = createServerFn({ method: "POST" })
  .validator(attributeInput)
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      if (data.productTypeId) {
        const [type] = await db
          .select({ id: schema.productTypes.id })
          .from(schema.productTypes)
          .where(eq(schema.productTypes.id, data.productTypeId))
          .limit(1)
        if (!type) throw new AppError("NOT_FOUND", "Product type not found")
      }
      let slug = slugify(data.name)
      const [taken] = await db
        .select({ id: schema.attributeDefinitions.id })
        .from(schema.attributeDefinitions)
        .where(
          and(
            eq(schema.attributeDefinitions.slug, slug),
            data.productTypeId
              ? eq(schema.attributeDefinitions.productTypeId, data.productTypeId)
              : sql`${schema.attributeDefinitions.productTypeId} IS NULL`,
          ),
        )
        .limit(1)
      if (taken) slug = slugWithSuffix(slug)
      try {
        const [row] = await db
          .insert(schema.attributeDefinitions)
          .values({
            productTypeId: data.productTypeId,
            name: data.name,
            slug,
            kind: data.kind,
            options: data.options,
            unit: data.unit,
            required: data.required,
            useForVariants: data.useForVariants,
            filterable: data.filterable,
            position: 0,
          })
          .returning()
        return row
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError("TAKEN", "That attribute name is taken")
        throw err
      }
    }),
  )

export const updateAttribute = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { id?: unknown } & Record<string, unknown>
    const id = String(raw.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id, ...attributeInput(input) }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      const [row] = await db
        .update(schema.attributeDefinitions)
        .set({
          name: data.name,
          kind: data.kind,
          options: data.options,
          unit: data.unit,
          required: data.required,
          useForVariants: data.useForVariants,
          filterable: data.filterable,
        })
        .where(eq(schema.attributeDefinitions.id, data.id))
        .returning()
      if (!row) throw new AppError("NOT_FOUND", "Attribute not found")
      return row
    }),
  )

export const deleteAttribute = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await db.delete(schema.attributeDefinitions).where(eq(schema.attributeDefinitions.id, data.id))
      return { deleted: true }
    }),
  )

export const reorderAttributes = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const ids = Array.isArray((input as { ids?: unknown })?.ids)
      ? ((input as { ids: unknown[] }).ids).map(String)
      : []
    if (ids.length === 0) throw new AppError("INVALID", "ids required")
    return { ids }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await db.transaction(async (tx) => {
        for (const [i, id] of data.ids.entries()) {
          await tx
            .update(schema.attributeDefinitions)
            .set({ position: i })
            .where(eq(schema.attributeDefinitions.id, id))
        }
      })
      return { ok: true }
    }),
  )

/** Public (any seller sees it while editing products): type options for the form select. */
export const listProductTypeOptions = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireUser()
    return db
      .select({ id: schema.productTypes.id, name: schema.productTypes.name })
      .from(schema.productTypes)
      .orderBy(asc(schema.productTypes.name))
  }),
)

/** Definitions for a type (+ global) — used by the product form's spec section. */
export const getTypeAttributeDefinitions = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = input as { productTypeId?: unknown }
    return { productTypeId: raw.productTypeId ? String(raw.productTypeId) : null }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireUser()
      const defs = await db
        .select()
        .from(schema.attributeDefinitions)
        .where(
          data.productTypeId
            ? sql`${schema.attributeDefinitions.productTypeId} IS NULL OR ${schema.attributeDefinitions.productTypeId} = ${data.productTypeId}`
            : sql`${schema.attributeDefinitions.productTypeId} IS NULL`,
        )
        .orderBy(asc(schema.attributeDefinitions.position), asc(schema.attributeDefinitions.name))
      return defs
    }),
  )

// ── seller: per-product spec values ─────────────────────────────────────────

export const getProductAttributes = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const id = String((input as { productId?: unknown })?.productId ?? "")
    if (!id) throw new AppError("INVALID", "productId required")
    return { productId: id }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireUser()
      const [product] = await db
        .select({ productTypeId: schema.products.productTypeId })
        .from(schema.products)
        .where(eq(schema.products.id, data.productId))
        .limit(1)
      if (!product) throw new AppError("NOT_FOUND", "Product not found")

      const defs = await db
        .select()
        .from(schema.attributeDefinitions)
        .where(
          product.productTypeId
            ? sql`${schema.attributeDefinitions.productTypeId} IS NULL OR ${schema.attributeDefinitions.productTypeId} = ${product.productTypeId}`
            : sql`${schema.attributeDefinitions.productTypeId} IS NULL`,
        )
        .orderBy(asc(schema.attributeDefinitions.position), asc(schema.attributeDefinitions.name))

      const values = await db
        .select()
        .from(schema.productAttributeValues)
        .where(eq(schema.productAttributeValues.productId, data.productId))
      const valueByAttribute = new Map(values.map((v) => [v.attributeId, v.value]))

      return {
        definitions: defs,
        values: Object.fromEntries(
          [...valueByAttribute.entries()].map(([id, value]) => [id, value]),
        ),
      }
    }),
  )

export const setProductAttributes = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { productId?: unknown; values?: unknown }
    const productId = String(raw.productId ?? "")
    if (!productId) throw new AppError("INVALID", "productId required")
    const values = Array.isArray(raw.values)
      ? (raw.values as { attributeId: unknown; value: unknown }[]).map((v) => ({
          attributeId: String(v.attributeId),
          value: v.value,
        }))
      : []
    return { productId, values }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [product] = await db
        .select({
          productTypeId: schema.products.productTypeId,
          status: schema.products.status,
          ownerId: schema.shops.ownerId,
        })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.products.id, data.productId))
        .limit(1)
      if (!product) throw new AppError("NOT_FOUND", "Product not found")
      if (user.role !== "super_admin" && user.id !== product.ownerId) {
        throw new AppError("FORBIDDEN", "You can only manage your own products")
      }

      const defs = await db
        .select()
        .from(schema.attributeDefinitions)
        .where(
          product.productTypeId
            ? sql`${schema.attributeDefinitions.productTypeId} IS NULL OR ${schema.attributeDefinitions.productTypeId} = ${product.productTypeId}`
            : sql`${schema.attributeDefinitions.productTypeId} IS NULL`,
        )
      const defById = new Map(defs.map((d) => [d.id, d]))

      const rows: { productId: string; attributeId: string; value: AttributeValue }[] = []
      for (const entry of data.values) {
        const def = defById.get(entry.attributeId)
        if (!def) throw new AppError("INVALID", "Unknown attribute")
        rows.push({
          productId: data.productId,
          attributeId: def.id,
          value: validateAttributeValue(def, entry.value),
        })
      }
      // required attributes must have a value when the product is published
      if (product.status === "active") {
        const provided = new Set(rows.map((r) => r.attributeId))
        const missing = defs.filter(
          (d) => d.required && !provided.has(d.id)
        )
        if (missing.length > 0) {
          throw new AppError(
            "INVALID",
            `Missing required specifications: ${missing.map((d) => d.name).join(", ")}`,
          )
        }
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(schema.productAttributeValues)
          .where(eq(schema.productAttributeValues.productId, data.productId))
        if (rows.length > 0) {
          await tx.insert(schema.productAttributeValues).values(rows)
        }
      })
      return { ok: true, count: rows.length }
    }),
  )

// ── public: facets (consumed by plan-8) ─────────────────────────────────────

export const getAttributeFacets = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const categorySlug = String((input as { categorySlug?: unknown })?.categorySlug ?? "")
    if (!categorySlug) throw new AppError("INVALID", "categorySlug required")
    return { categorySlug }
  })
  .handler(({ data }) =>
    guard(async () => {
      const filterable = await db
        .select()
        .from(schema.attributeDefinitions)
        .where(eq(schema.attributeDefinitions.filterable, true))
      if (filterable.length === 0) return []

      const counts = await db
        .select({
          attributeId: schema.productAttributeValues.attributeId,
          value: schema.productAttributeValues.value,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.productAttributeValues)
        .innerJoin(
          schema.products,
          eq(schema.productAttributeValues.productId, schema.products.id),
        )
        .innerJoin(
          schema.categories,
          eq(schema.products.categoryId, schema.categories.id),
        )
        .where(
          and(
            eq(schema.categories.slug, data.categorySlug),
            eq(schema.products.status, "active"),
            inArray(
              schema.productAttributeValues.attributeId,
              filterable.map((f) => f.id),
            ),
          ),
        )
        .groupBy(schema.productAttributeValues.attributeId, schema.productAttributeValues.value)

      return filterable
        .map((def) => ({
          attributeId: def.id,
          name: def.name,
          slug: def.slug,
          kind: def.kind,
          unit: def.unit,
          values: counts
            .filter((c) => c.attributeId === def.id)
            .map((c) => ({ value: c.value, count: c.count }))
            .sort((a, b) => String(a.value).localeCompare(String(b.value)))
            .slice(0, 8),
        }))
        .filter((f) => f.values.length > 0)
    }),
  )
