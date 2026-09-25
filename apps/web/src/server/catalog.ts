import { createServerFn } from "@tanstack/react-start"
import {
  db,
  schema,
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "@ecommerce/db"
import { cachedJson, getRedis, invalidateCache } from "@ecommerce/redis"
import { parsePriceToCents, slugify, slugWithSuffix } from "@ecommerce/config"
import { AppError, guard, requireRole, requireUser } from "./session"
import { validateAttributeValue } from "./attributes"

/** Escape LIKE/ILIKE wildcards so user input can't inject patterns. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&")
}

/** Distinguish Postgres unique-violations for friendly "already taken" errors. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  )
}

const PAGE_SIZE = 12

// ─── Public: categories & tags ───────────────────────────────────────────────

export const getCategories = createServerFn({ method: "GET" }).handler(() =>
  guard(async () =>
    // 60s cache (plan-7); timestamps excluded so the JSON round-trip stays honest
    cachedJson("catalog:categories:v1", 60, async () =>
      db
        .select({
          id: schema.categories.id,
          name: schema.categories.name,
          slug: schema.categories.slug,
          parentId: schema.categories.parentId,
          description: schema.categories.description,
          sortOrder: schema.categories.sortOrder,
        })
        .from(schema.categories)
        .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name))
    )
  )
)

export const getTags = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    return db.select().from(schema.tags).orderBy(asc(schema.tags.name))
  })
)

// ─── Admin: taxonomy management ─────────────────────────────────────────────

const categoryInput = (input: unknown) => {
  const parsed = input as {
    name?: unknown
    description?: unknown
    parentId?: unknown
  } as { name: string; description?: string; parentId?: string | null }
  const name = String(parsed.name ?? "").trim()
  if (name.length < 2 || name.length > 80) {
    throw new AppError("INVALID", "Name must be 2–80 characters")
  }
  return {
    name,
    description: parsed.description
      ? String(parsed.description).slice(0, 500)
      : null,
    parentId: parsed.parentId || null,
  }
}

async function assertValidParent(
  parentId: string | null,
  selfId?: string
): Promise<void> {
  if (!parentId) return
  const seen = new Set<string>()
  let cursor: string | null = parentId
  while (cursor) {
    if (cursor === selfId) {
      throw new AppError("INVALID", "A category cannot be its own ancestor")
    }
    if (seen.has(cursor)) break // defensive: pre-existing cycle
    seen.add(cursor)
    const [row] = await db
      .select({ parentId: schema.categories.parentId })
      .from(schema.categories)
      .where(eq(schema.categories.id, cursor))
      .limit(1)
    if (!row) throw new AppError("INVALID", "Parent category not found")
    cursor = row.parentId
  }
}

async function uniqueSlug(
  table: typeof schema.categories | typeof schema.tags,
  name: string
): Promise<string> {
  const base = slugify(name)
  const isCategories = table === schema.categories
  const slugCol = isCategories ? schema.categories.slug : schema.tags.slug
  const [taken] = await db
    .select({ id: (table as typeof schema.categories).id })
    .from(table)
    .where(eq(slugCol, base))
    .limit(1)
  return taken ? slugWithSuffix(base) : base
}

export const createCategory = createServerFn({ method: "POST" })
  .validator(categoryInput)
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await assertValidParent(data.parentId)
      const slug = await uniqueSlug(schema.categories, data.name)
      const [row] = await db
        .insert(schema.categories)
        .values({
          name: data.name,
          slug,
          description: data.description,
          parentId: data.parentId,
        })
        .returning()
      await invalidateCache("catalog:categories:v1")
      return row
    })
  )

export const updateCategory = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { id?: unknown } & Record<string, unknown>
    if (typeof raw.id !== "string") throw new AppError("INVALID", "id required")
    return { id: raw.id, ...categoryInput(input) }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await assertValidParent(data.parentId, data.id)
      const [row] = await db
        .update(schema.categories)
        .set({
          name: data.name,
          description: data.description,
          parentId: data.parentId,
        })
        .where(eq(schema.categories.id, data.id))
        .returning()
      if (!row) throw new AppError("NOT_FOUND", "Category not found")
      await invalidateCache("catalog:categories:v1")
      return row
    })
  )

export const deleteCategory = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const { id } = input as { id?: unknown }
    if (typeof id !== "string") throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      const inUse = await db.$count(
        schema.products,
        eq(schema.products.categoryId, data.id)
      )
      if (inUse > 0) {
        throw new AppError(
          "IN_USE",
          `Cannot delete — ${inUse} product(s) use this category. Reassign them first.`
        )
      }
      await db
        .delete(schema.categories)
        .where(eq(schema.categories.id, data.id))
      await invalidateCache("catalog:categories:v1")
      return { deleted: true }
    })
  )

export const createTag = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const name = String((input as { name?: unknown }).name ?? "").trim()
    if (name.length < 2 || name.length > 40) {
      throw new AppError("INVALID", "Name must be 2–40 characters")
    }
    return { name }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      const slug = await uniqueSlug(schema.tags, data.name)
      const [row] = await db
        .insert(schema.tags)
        .values({ name: data.name, slug })
        .returning()
      return row
    })
  )

export const deleteTag = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const { id } = input as { id?: unknown }
    if (typeof id !== "string") throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await db.delete(schema.tags).where(eq(schema.tags.id, data.id))
      return { deleted: true }
    })
  )

// ─── Public: browse ─────────────────────────────────────────────────────────

export type ProductFilters = {
  q?: string
  category?: string
  tag?: string
  min?: number
  max?: number
  sort?: "newest" | "price-asc" | "price-desc" | "rating-desc"
  page?: number
  minRating?: number
  /** attribute facet filters: attribute slug → value(s) */
  attributes?: Record<string, string[]>
}

const productCardColumns = {
  id: schema.products.id,
  title: schema.products.title,
  slug: schema.products.slug,
  priceCents: schema.products.priceCents,
  currency: schema.products.currency,
  stock: schema.products.stock,
  shopName: schema.shops.name,
  shopSlug: schema.shops.slug,
  brand: schema.products.brand,
  condition: schema.products.condition,
  ratingAvgX100: schema.products.ratingAvgX100,
  ratingCount: schema.products.ratingCount,
  imageUrl: sql<string | null>`(
    select pi.url from product_images pi
    where pi.product_id = "products"."id"
    order by pi.sort_order asc limit 1
  )`,
}

export const listProducts = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const f = (input ?? {}) as ProductFilters
    return {
      q: f.q?.slice(0, 100),
      category: f.category?.slice(0, 100),
      tag: f.tag?.slice(0, 100),
      min: typeof f.min === "number" ? f.min : undefined,
      max: typeof f.max === "number" ? f.max : undefined,
      sort: f.sort ?? "newest",
      page: Math.max(1, f.page ?? 1),
      minRating: typeof f.minRating === "number" ? f.minRating : undefined,
      attributes:
        f.attributes && typeof f.attributes === "object"
          ? Object.fromEntries(
              Object.entries(f.attributes)
                .slice(0, 5)
                .map(([k, v]) => [
                  k.replace(/[^a-z0-9-]/gi, ""),
                  Array.isArray(v) ? v.map(String).slice(0, 10) : [String(v)],
                ]),
            )
          : undefined,
    } satisfies ProductFilters
  })
  .handler(({ data }) =>
    guard(async () => {
      const conditions = [
        eq(schema.products.status, "active"),
        eq(schema.shops.status, "active"),
      ]
      if (data.q) {
        const like = `%${escapeLike(data.q)}%`
        conditions.push(
          or(
            ilike(schema.products.title, like),
            ilike(schema.products.description, like)
          )!
        )
      }
      if (data.category)
        conditions.push(eq(schema.categories.slug, data.category))
      if (data.tag) conditions.push(eq(schema.tags.slug, data.tag))
      if (data.min !== undefined)
        conditions.push(
          gte(schema.products.priceCents, Math.round(data.min * 100))
        )
      if (data.max !== undefined)
        conditions.push(
          lte(schema.products.priceCents, Math.round(data.max * 100))
        )

      const where = and(...conditions)

      const orderBy =
        data.sort === "price-asc"
          ? asc(schema.products.priceCents)
          : data.sort === "price-desc"
            ? desc(schema.products.priceCents)
            : data.sort === "rating-desc"
              ? sql`"products"."rating_count" DESC, "products"."rating_avg_x100" DESC, "products"."created_at" DESC`
              : desc(schema.products.createdAt)

      let query = db
        .select(productCardColumns)
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .leftJoin(
          schema.categories,
          eq(schema.products.categoryId, schema.categories.id)
        )
        .$dynamic()

      if (data.tag) {
        query = query
          .innerJoin(
            schema.productTags,
            eq(schema.productTags.productId, schema.products.id)
          )
          .innerJoin(schema.tags, eq(schema.productTags.tagId, schema.tags.id))
      }

      const items = await query
        .where(where)
        .orderBy(orderBy)
        .limit(PAGE_SIZE)
        .offset((data.page - 1) * PAGE_SIZE)

      let countQuery = db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .leftJoin(
          schema.categories,
          eq(schema.products.categoryId, schema.categories.id)
        )
        .$dynamic()
      if (data.tag) {
        countQuery = countQuery
          .innerJoin(
            schema.productTags,
            eq(schema.productTags.productId, schema.products.id)
          )
          .innerJoin(schema.tags, eq(schema.productTags.tagId, schema.tags.id))
      }
      const [{ total }] = await countQuery.where(where)

      return { items, total, page: data.page, pageSize: PAGE_SIZE }
    })
  )

export const getProduct = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const slug = String((input as { slug?: unknown })?.slug ?? "")
    if (slug.length < 1) throw new AppError("INVALID", "slug required")
    return { slug }
  })
  .handler(({ data }) =>
    guard(async () => {
      const [row] = await db
        .select({
          product: schema.products,
          shop: {
            id: schema.shops.id,
            name: schema.shops.name,
            slug: schema.shops.slug,
            description: schema.shops.description,
            status: schema.shops.status,
            ownerId: schema.shops.ownerId,
          },
          categoryName: schema.categories.name,
          categorySlug: schema.categories.slug,
        })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .leftJoin(
          schema.categories,
          eq(schema.products.categoryId, schema.categories.id)
        )
        .where(eq(schema.products.slug, data.slug))
        .limit(1)
      if (!row) throw new AppError("NOT_FOUND", "Product not found")

      const isPublic =
        row.product.status === "active" && row.shop.status === "active"
      if (!isPublic) {
        // drafts/archived are visible to their owner and admins only
        const user = await requireUser().catch(() => null)
        const canView =
          user && (user.role === "super_admin" || user.id === row.shop.ownerId)
        if (!canView) throw new AppError("NOT_FOUND", "Product not found")
      }

      const images = await db
        .select()
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, row.product.id))
        .orderBy(asc(schema.productImages.sortOrder))
      const tags = await db
        .select({
          id: schema.tags.id,
          name: schema.tags.name,
          slug: schema.tags.slug,
        })
        .from(schema.productTags)
        .innerJoin(schema.tags, eq(schema.productTags.tagId, schema.tags.id))
        .where(eq(schema.productTags.productId, row.product.id))

      // Spec sheet (plan-4): non-variant-axis attributes with values
      const attributes = await db
        .select({
          name: schema.attributeDefinitions.name,
          slug: schema.attributeDefinitions.slug,
          unit: schema.attributeDefinitions.unit,
          useForVariants: schema.attributeDefinitions.useForVariants,
          value: schema.productAttributeValues.value,
        })
        .from(schema.productAttributeValues)
        .innerJoin(
          schema.attributeDefinitions,
          eq(schema.productAttributeValues.attributeId, schema.attributeDefinitions.id),
        )
        .where(eq(schema.productAttributeValues.productId, row.product.id))
        .orderBy(asc(schema.attributeDefinitions.position))

      // Variants (public: active only; owners/admins see all via listVariants)
      const variants = await db
        .select({
          id: schema.productVariants.id,
          sku: schema.productVariants.sku,
          title: schema.productVariants.title,
          priceCents: schema.productVariants.priceCents,
          stock: schema.productVariants.stock,
          imageId: schema.productVariants.imageId,
          isDefault: schema.productVariants.isDefault,
          options: sql<
            { attributeId: string; value: string }[]
          >`coalesce((
            select json_agg(json_build_object('attributeId', vov.attribute_id, 'value', vov.value))
            from variant_option_values vov where vov.variant_id = ${schema.productVariants.id}
          ), '[]'::json)`,
        })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.productId, row.product.id),
            eq(schema.productVariants.status, "active"),
          ),
        )
        .orderBy(asc(schema.productVariants.position))

      return { ...row, images, tags, attributes, variants }
    })
  )

export const getShop = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const slug = String((input as { slug?: unknown })?.slug ?? "")
    if (!slug) throw new AppError("INVALID", "slug required")
    return { slug }
  })
  .handler(({ data }) =>
    guard(async () => {
      const [shop] = await db
        .select()
        .from(schema.shops)
        .where(eq(schema.shops.slug, data.slug))
        .limit(1)
      if (!shop || shop.status !== "active") {
        throw new AppError("NOT_FOUND", "Shop not found")
      }
      const items = await db
        .select(productCardColumns)
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(
          and(
            eq(schema.products.shopId, shop.id),
            eq(schema.products.status, "active")
          )
        )
        .orderBy(desc(schema.products.createdAt))
        .limit(24)
      return { shop, items }
    })
  )

export const listProductsBySlugs = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = input as { slugs?: unknown }
    const slugs = Array.isArray(raw.slugs) ? raw.slugs.map(String).slice(0, 12) : []
    return { slugs }
  })
  .handler(({ data }) =>
    guard(async () => {
      if (data.slugs.length === 0) return []
      const rows = await db
        .select(productCardColumns)
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(
          and(
            inArray(schema.products.slug, data.slugs),
            eq(schema.products.status, "active"),
            eq(schema.shops.status, "active"),
          ),
        )
      const bySlug = new Map(rows.map((r) => [r.slug, r]))
      return data.slugs
        .map((slug) => bySlug.get(slug))
        .filter((p): p is (typeof rows)[number] => p !== undefined)
    }),
  )

// ─── Seller: product management ─────────────────────────────────────────────

export const listSellerProducts = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const f = (input ?? {}) as { page?: number; pageSize?: number; q?: string }
    return {
      page: Math.max(1, f.page ?? 1),
      pageSize: Math.min(50, Math.max(5, f.pageSize ?? 10)),
      q: f.q?.slice(0, 100),
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [shop] = await db
        .select()
        .from(schema.shops)
        .where(eq(schema.shops.ownerId, user.id))
        .limit(1)

      const conditions = [eq(schema.products.shopId, shop.id)]
      if (data.q) conditions.push(ilike(schema.products.title, `%${data.q}%`))
      const where = and(...conditions)

      const rows = await db
        .select({
          id: schema.products.id,
          title: schema.products.title,
          slug: schema.products.slug,
          priceCents: schema.products.priceCents,
          currency: schema.products.currency,
          stock: schema.products.stock,
          status: schema.products.status,
          updatedAt: schema.products.updatedAt,
          imageUrl: sql<string | null>`(
            select pi.url from product_images pi
            where pi.product_id = ${schema.products.id}
            order by pi.sort_order asc limit 1
          )`,
        })
        .from(schema.products)
        .where(where)
        .orderBy(desc(schema.products.updatedAt))
        .limit(data.pageSize)
        .offset((data.page - 1) * data.pageSize)
      const total = await db.$count(schema.products, where)
      return { rows, total, page: data.page, pageSize: data.pageSize }
    })
  )

async function myShop(userId: string) {
  const [shop] = await db
    .select()
    .from(schema.shops)
    .where(eq(schema.shops.ownerId, userId))
    .limit(1)
  if (!shop) throw new AppError("FORBIDDEN", "Create your shop first")
  return shop
}

const productFields = (input: unknown) => {
  const raw = input as Record<string, unknown>
  const title = String(raw.title ?? "").trim()
  const description = String(raw.description ?? "").trim()
  const priceCents = parsePriceToCents(String(raw.price ?? ""))
  const stock = Number(raw.stock ?? 0)
  const status: "active" | "draft" =
    raw.status === "active" ? "active" : "draft"
  const categoryId = raw.categoryId ? String(raw.categoryId) : null
  const tagIds = Array.isArray(raw.tagIds)
    ? (raw.tagIds as string[]).map(String)
    : []
  if (title.length < 3 || title.length > 200) {
    throw new AppError("INVALID", "Title must be 3–200 characters")
  }
  if (description.length < 10 || description.length > 5000) {
    throw new AppError("INVALID", "Description must be 10–5000 characters")
  }
  if (priceCents === null || priceCents <= 0) {
    throw new AppError("INVALID", "Enter a valid price")
  }
  if (!Number.isInteger(stock) || stock < 0) {
    throw new AppError("INVALID", "Stock must be a non-negative whole number")
  }
  if (tagIds.length > 10) throw new AppError("INVALID", "Max 10 tags")

  const brand = raw.brand ? String(raw.brand).trim().slice(0, 80) : null
  const summary = raw.summary ? String(raw.summary).trim().slice(0, 300) : null
  const condition = ["new", "used", "refurbished"].includes(String(raw.condition))
    ? (String(raw.condition) as "new" | "used" | "refurbished")
    : "new"
  const weightGrams =
    raw.weightGrams === undefined || raw.weightGrams === null || raw.weightGrams === ""
      ? null
      : Number(raw.weightGrams)
  if (weightGrams !== null && (!Number.isInteger(weightGrams) || weightGrams < 0)) {
    throw new AppError("INVALID", "Weight must be a non-negative whole number of grams")
  }
  let dimensions: { l: number; w: number; h: number } | null = null
  if (
    raw.dimensions &&
    typeof raw.dimensions === "object" &&
    !Array.isArray(raw.dimensions)
  ) {
    const d = raw.dimensions as Record<string, unknown>
    const l = Number(d.l)
    const w = Number(d.w)
    const h = Number(d.h)
    const ok = [l, w, h].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)
    if (!ok) throw new AppError("INVALID", "Dimensions must be whole millimetres (0–100000)")
    dimensions = { l, w, h }
  }
  const seoTitle = raw.seoTitle ? String(raw.seoTitle).trim().slice(0, 200) : null
  const seoDescription = raw.seoDescription
    ? String(raw.seoDescription).trim().slice(0, 300)
    : null
  const lowStockThreshold =
    raw.lowStockThreshold === undefined || raw.lowStockThreshold === ""
      ? 5
      : Number(raw.lowStockThreshold)
  if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
    throw new AppError("INVALID", "Low-stock threshold must be a non-negative whole number")
  }

  const productTypeId = raw.productTypeId ? String(raw.productTypeId) : null
  const attributes = Array.isArray(raw.attributes)
    ? (raw.attributes as { attributeId: unknown; value: unknown }[])
        .map((a) => ({ attributeId: String(a.attributeId), value: a.value }))
        .slice(0, 30)
    : []
  return {
    title, description, priceCents, stock, status, categoryId, tagIds, productTypeId,
    brand, summary, condition, weightGrams, dimensions, seoTitle, seoDescription, lowStockThreshold,
    attributes,
  }
}

/** Validate + persist product attribute values against their definitions. */
async function persistProductAttributes(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  productId: string,
  productTypeId: string | null,
  rawValues: { attributeId: string; value: unknown }[],
  published: boolean,
): Promise<void> {
  if (rawValues.length > 0) {
    const ids = [...new Set(rawValues.map((v) => v.attributeId))]
    const defs = await tx
      .select()
      .from(schema.attributeDefinitions)
      .where(inArray(schema.attributeDefinitions.id, ids))
    const defById = new Map(defs.map((d) => [d.id, d]))
    const values = rawValues.flatMap((v) => {
      const def = defById.get(v.attributeId)
      if (!def) return []
      // attributes from a different type/global are allowed if still visible
      return [{ attributeId: def.id, value: validateAttributeValue(def, v.value) }]
    })
    await tx
      .delete(schema.productAttributeValues)
      .where(eq(schema.productAttributeValues.productId, productId))
    await tx
      .insert(schema.productAttributeValues)
      .values(values.map((v) => ({ productId, attributeId: v.attributeId, value: v.value })))
  }
  if (published) {
    const provided = new Set(rawValues.map((v) => v.attributeId))
    const requiredDefs = await tx
      .select({ id: schema.attributeDefinitions.id, name: schema.attributeDefinitions.name })
      .from(schema.attributeDefinitions)
      .where(
        and(
          eq(schema.attributeDefinitions.required, true),
          productTypeId
            ? sql`${schema.attributeDefinitions.productTypeId} IS NULL OR ${schema.attributeDefinitions.productTypeId} = ${productTypeId}`
            : sql`${schema.attributeDefinitions.productTypeId} IS NULL`,
        ),
      )
    const missing = requiredDefs.filter((d) => !provided.has(d.id))
    if (missing.length > 0) {
      throw new AppError(
        "INVALID",
        `Missing required specifications: ${missing.map((d) => d.name).join(", ")}`,
      )
    }
  }
}

export const createProduct = createServerFn({ method: "POST" })
  .validator(productFields)
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const shop = await myShop(user.id)
      let slug = slugify(data.title)
      const [taken] = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.slug, slug))
        .limit(1)
      if (taken) slug = slugWithSuffix(slug)

      try {
        return await db.transaction(async (tx) => {
          const [product] = await tx
            .insert(schema.products)
            .values({
              shopId: shop.id,
              categoryId: data.categoryId,
              productTypeId: data.productTypeId,
              title: data.title,
              slug,
              description: data.description,
              summary: data.summary,
              brand: data.brand,
              condition: data.condition,
              weightGrams: data.weightGrams,
              dimensions: data.dimensions,
              seoTitle: data.seoTitle,
              seoDescription: data.seoDescription,
              lowStockThreshold: data.lowStockThreshold,
              priceCents: data.priceCents,
              stock: data.stock,
              status: data.status,
            })
            .returning()
          if (data.tagIds.length > 0) {
            await tx
              .insert(schema.productTags)
              .values(
                data.tagIds.map((tagId) => ({ productId: product.id, tagId }))
              )
              .onConflictDoNothing()
          }
          await persistProductAttributes(
            tx,
            product.id,
            data.productTypeId,
            data.attributes,
            product.status === "active",
          )
          return { id: product.id, slug: product.slug }
        })
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(
            "TAKEN",
            "A product with a similar title already exists — try another title"
          )
        }
        throw err
      }
    })
  )

export const getProductForEdit = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [row] = await db
        .select({
          product: schema.products,
          ownerId: schema.shops.ownerId,
        })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.products.id, data.id))
        .limit(1)
      if (!row) throw new AppError("NOT_FOUND", "Product not found")
      if (user.role !== "super_admin" && user.id !== row.ownerId) {
        throw new AppError("FORBIDDEN", "You can only edit your own products")
      }
      const images = await db
        .select()
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, data.id))
        .orderBy(asc(schema.productImages.sortOrder))
      const tags = await db
        .select({ id: schema.productTags.tagId })
        .from(schema.productTags)
        .where(eq(schema.productTags.productId, data.id))
      const attributeValues = await db
        .select({
          attributeId: schema.productAttributeValues.attributeId,
          value: schema.productAttributeValues.value,
        })
        .from(schema.productAttributeValues)
        .where(eq(schema.productAttributeValues.productId, data.id))
      return {
        product: row.product,
        ownerId: row.ownerId,
        images,
        tagIds: tags.map((t) => t.id),
        attributes: attributeValues,
      }
    })
  )

export const updateProduct = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id, ...productFields(input) }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [row] = await db
        .select({ ownerId: schema.shops.ownerId })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.products.id, data.id))
        .limit(1)
      if (!row) throw new AppError("NOT_FOUND", "Product not found")
      if (user.role !== "super_admin" && user.id !== row.ownerId) {
        throw new AppError("FORBIDDEN", "You can only edit your own products")
      }

      return db.transaction(async (tx) => {
        const [product] = await tx
          .update(schema.products)
          .set({
            categoryId: data.categoryId,
            productTypeId: data.productTypeId,
            title: data.title,
            description: data.description,
            summary: data.summary,
            brand: data.brand,
            condition: data.condition,
            weightGrams: data.weightGrams,
            dimensions: data.dimensions,
            seoTitle: data.seoTitle,
            seoDescription: data.seoDescription,
            lowStockThreshold: data.lowStockThreshold,
            priceCents: data.priceCents,
            stock: data.stock,
            status: data.status,
          })
          .where(eq(schema.products.id, data.id))
          .returning()
        await tx
          .delete(schema.productTags)
          .where(eq(schema.productTags.productId, data.id))
        if (data.tagIds.length > 0) {
          await tx
            .insert(schema.productTags)
            .values(data.tagIds.map((tagId) => ({ productId: data.id, tagId })))
            .onConflictDoNothing()
        }
        await persistProductAttributes(
          tx,
          data.id,
          data.productTypeId,
          data.attributes,
          product.status === "active",
        )
        return { id: product.id, slug: product.slug }
      })
    })
  )

export const archiveProduct = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { id?: unknown; status?: unknown }
    const id = String(raw.id ?? "")
    const status = String(raw.status ?? "archived")
    if (!id) throw new AppError("INVALID", "id required")
    if (!["draft", "active", "archived"].includes(status)) {
      throw new AppError("INVALID", "Invalid status")
    }
    return { id, status: status as "draft" | "active" | "archived" }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [row] = await db
        .select({ ownerId: schema.shops.ownerId })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.products.id, data.id))
        .limit(1)
      if (!row) throw new AppError("NOT_FOUND", "Product not found")
      if (user.role !== "super_admin" && user.id !== row.ownerId) {
        throw new AppError("FORBIDDEN", "You can only manage your own products")
      }
      await db
        .update(schema.products)
        .set({ status: data.status })
        .where(eq(schema.products.id, data.id))
      return { ok: true }
    })
  )

// ─── Admin: moderation ──────────────────────────────────────────────────────

export const adminListProducts = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const f = (input ?? {}) as { status?: unknown; page?: number }
    const rawStatus = String(f.status ?? "")
    return {
      status: ["draft", "active", "archived"].includes(rawStatus)
        ? (rawStatus as "draft" | "active" | "archived")
        : undefined,
      page: Math.max(1, f.page ?? 1),
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      const where = data.status
        ? eq(schema.products.status, data.status)
        : undefined
      const rows = await db
        .select({
          ...productCardColumns,
          status: schema.products.status,
          createdAt: schema.products.createdAt,
        })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(where)
        .orderBy(desc(schema.products.createdAt))
        .limit(20)
        .offset((data.page - 1) * 20)
      const total = await db.$count(schema.products, where)
      return { rows, total }
    })
  )

export const adminListProductsByIds = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const { ids } = input as { ids?: unknown }
    if (!Array.isArray(ids)) throw new AppError("INVALID", "ids required")
    return { ids: ids.map(String) }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      if (data.ids.length === 0) return []
      return db
        .select()
        .from(schema.products)
        .where(inArray(schema.products.id, data.ids))
    })
  )

// ── Image reordering (plan-2) ───────────────────────────────────────────────

export const reorderProductImages = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { productId?: unknown; imageIds?: unknown }
    const productId = String(raw.productId ?? "")
    const imageIds = Array.isArray(raw.imageIds) ? raw.imageIds.map(String) : []
    if (!productId || imageIds.length === 0) {
      throw new AppError("INVALID", "productId and imageIds required")
    }
    return { productId, imageIds }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [row] = await db
        .select({ ownerId: schema.shops.ownerId })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.products.id, data.productId))
        .limit(1)
      if (!row) throw new AppError("NOT_FOUND", "Product not found")
      if (user.role !== "super_admin" && user.id !== row.ownerId) {
        throw new AppError("FORBIDDEN", "You can only manage your own products")
      }
      const existing = await db
        .select({ id: schema.productImages.id })
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, data.productId))
      const existingIds = new Set(existing.map((i) => i.id))
      if (
        data.imageIds.length !== existingIds.size ||
        data.imageIds.some((id) => !existingIds.has(id))
      ) {
        throw new AppError("INVALID", "Image list does not match this product's images")
      }
      await db.transaction(async (tx) => {
        for (const [i, id] of data.imageIds.entries()) {
          await tx
            .update(schema.productImages)
            .set({ sortOrder: i })
            .where(eq(schema.productImages.id, id))
        }
      })
      return { ok: true }
    }),
  )

// ── Related products (plan-2): same category, else same shop ────────────────

export const listRelatedProducts = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = input as { slug?: unknown; limit?: unknown }
    const slug = String(raw.slug ?? "")
    if (!slug) throw new AppError("INVALID", "slug required")
    const limit = Math.min(8, Math.max(2, Number(raw.limit ?? 4)))
    return { slug, limit }
  })
  .handler(({ data }) =>
    guard(async () => {
      const [row] = await db
        .select({
          id: schema.products.id,
          categoryId: schema.products.categoryId,
          shopId: schema.products.shopId,
        })
        .from(schema.products)
        .where(eq(schema.products.slug, data.slug))
        .limit(1)
      if (!row) throw new AppError("NOT_FOUND", "Product not found")

      const base = db
        .select(productCardColumns)
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .$dynamic()

      const sameCategory = row.categoryId
        ? await base
            .where(
              and(
                eq(schema.products.status, "active"),
                eq(schema.shops.status, "active"),
                eq(schema.products.categoryId, row.categoryId),
                sql`${schema.products.id} <> ${row.id}`,
              ),
            )
            .orderBy(desc(schema.products.createdAt))
            .limit(data.limit)
        : []
      if (sameCategory.length >= data.limit) return sameCategory

      const exclude = new Set([row.id, ...sameCategory.map((p) => p.id)])
      const fillers = await base
        .where(
          and(
            eq(schema.products.status, "active"),
            eq(schema.shops.status, "active"),
            eq(schema.products.shopId, row.shopId),
            sql`${schema.products.id} <> ${row.id}`,
          ),
        )
        .orderBy(desc(schema.products.createdAt))
        .limit(data.limit * 2)
      const related = [...sameCategory]
      for (const f of fillers) {
        if (related.length >= data.limit) break
        if (!exclude.has(f.id)) related.push(f)
      }
      return related
    }),
  )

// ── Plan-7: bulk operations, duplication, CSV export, category reorder ──────

export const bulkSetProductStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { productIds?: unknown; status?: unknown }
    const productIds = Array.isArray(raw.productIds) ? raw.productIds.map(String) : []
    const status = String(raw.status ?? "")
    if (productIds.length === 0 || productIds.length > 100) {
      throw new AppError("INVALID", "Select 1–100 products")
    }
    if (!["draft", "active", "archived"].includes(status)) {
      throw new AppError("INVALID", "Invalid status")
    }
    return {
      productIds,
      status: status as "draft" | "active" | "archived",
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      let updated = 0
      for (const productId of data.productIds) {
        const [row] = await db
          .select({ ownerId: schema.shops.ownerId })
          .from(schema.products)
          .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
          .where(eq(schema.products.id, productId))
          .limit(1)
        if (!row) continue
        if (user.role !== "super_admin" && user.id !== row.ownerId) continue
        await db
          .update(schema.products)
          .set({ status: data.status })
          .where(eq(schema.products.id, productId))
        updated++
      }
      return { updated, skipped: data.productIds.length - updated }
    }),
  )

export const duplicateProduct = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const productId = String((input as { productId?: unknown })?.productId ?? "")
    if (!productId) throw new AppError("INVALID", "productId required")
    return { productId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [row] = await db
        .select({ product: schema.products, ownerId: schema.shops.ownerId })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.products.id, data.productId))
        .limit(1)
      if (!row) throw new AppError("NOT_FOUND", "Product not found")
      if (user.role !== "super_admin" && user.id !== row.ownerId) {
        throw new AppError("FORBIDDEN", "You can only duplicate your own products")
      }
      const src = row.product

      let slug = slugify(`${src.title} copy`)
      const [taken] = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.slug, slug))
        .limit(1)
      if (taken) slug = slugWithSuffix(slug)

      const copy = await db.transaction(async (tx) => {
        const [product] = await tx
          .insert(schema.products)
          .values({
            shopId: src.shopId,
            categoryId: src.categoryId,
            productTypeId: src.productTypeId,
            title: `${src.title} (copy)`,
            slug,
            description: src.description,
            summary: src.summary,
            brand: src.brand,
            condition: src.condition,
            weightGrams: src.weightGrams,
            dimensions: src.dimensions,
            seoTitle: src.seoTitle,
            seoDescription: src.seoDescription,
            lowStockThreshold: src.lowStockThreshold,
            priceCents: src.priceCents,
            stock: src.stock,
            currency: src.currency,
            status: "draft",
          })
          .returning()
        const srcTags = await tx
          .select({ tagId: schema.productTags.tagId })
          .from(schema.productTags)
          .where(eq(schema.productTags.productId, src.id))
        if (srcTags.length > 0) {
          await tx
            .insert(schema.productTags)
            .values(srcTags.map((t) => ({ productId: product.id, tagId: t.tagId })))
            .onConflictDoNothing()
        }
        const srcAttrs = await tx
          .select()
          .from(schema.productAttributeValues)
          .where(eq(schema.productAttributeValues.productId, src.id))
        if (srcAttrs.length > 0) {
          await tx.insert(schema.productAttributeValues).values(
            srcAttrs.map((a) => ({ productId: product.id, attributeId: a.attributeId, value: a.value })),
          )
        }
        // images: rows reference the same S3 objects (no object copy needed)
        const srcImages = await tx
          .select()
          .from(schema.productImages)
          .where(eq(schema.productImages.productId, src.id))
          .orderBy(asc(schema.productImages.sortOrder))
        const imageIdMap = new Map<string, string>()
        for (const img of srcImages) {
          const [newImage] = await tx
            .insert(schema.productImages)
            .values({
              productId: product.id,
              key: img.key,
              url: img.url,
              alt: img.alt,
              sortOrder: img.sortOrder,
            })
            .returning({ id: schema.productImages.id })
          imageIdMap.set(img.id, newImage.id)
        }
        // variants + option values
        const srcVariants = await tx
          .select()
          .from(schema.productVariants)
          .where(eq(schema.productVariants.productId, src.id))
          .orderBy(asc(schema.productVariants.position))
        for (const [i, v] of srcVariants.entries()) {
          const [newVariant] = await tx
            .insert(schema.productVariants)
            .values({
              productId: product.id,
              sku: `${v.sku}-C${i + 1}`,
              title: v.title,
              priceCents: v.priceCents,
              stock: v.stock,
              weightGrams: v.weightGrams,
              imageId: v.imageId ? (imageIdMap.get(v.imageId) ?? null) : null,
              isDefault: v.isDefault,
              status: "draft",
              position: v.position,
            })
            .returning({ id: schema.productVariants.id })
          const srcOpts = await tx
            .select()
            .from(schema.variantOptionValues)
            .where(eq(schema.variantOptionValues.variantId, v.id))
          if (srcOpts.length > 0) {
            await tx.insert(schema.variantOptionValues).values(
              srcOpts.map((o) => ({
                variantId: newVariant.id,
                attributeId: o.attributeId,
                value: o.value,
              })),
            )
          }
        }
        return { id: product.id, slug: product.slug }
      })
      return copy
    }),
  )

export const reorderCategories = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { parentId?: unknown; orderedIds?: unknown }
    const orderedIds = Array.isArray(raw.orderedIds) ? raw.orderedIds.map(String) : []
    if (orderedIds.length === 0) throw new AppError("INVALID", "orderedIds required")
    const parentId = raw.parentId ? String(raw.parentId) : null
    return { parentId, orderedIds }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await db.transaction(async (tx) => {
        for (const [i, id] of data.orderedIds.entries()) {
          await tx
            .update(schema.categories)
            .set({ sortOrder: i, parentId: data.parentId })
            .where(eq(schema.categories.id, id))
        }
      })
      await getRedis().del("catalog:categories:v1").catch(() => undefined)
      return { ok: true }
    }),
  )

export const exportProductsCsv = createServerFn({ method: "GET" }).handler(
  async () => {
    // Raw Response (no Result envelope): streams a CSV attachment
    try {
      const user = await requireRole("seller", "super_admin")
      const [shop] = await db
        .select({ id: schema.shops.id })
        .from(schema.shops)
        .where(eq(schema.shops.ownerId, user.id))
        .limit(1)
      const where =
        user.role === "super_admin"
          ? undefined
          : shop
            ? eq(schema.products.shopId, shop.id)
            : sql`false`
      const rows = await db
        .select({
          kind: sql<string>`'product'`,
          title: schema.products.title,
          slug: schema.products.slug,
          brand: schema.products.brand,
          condition: schema.products.condition,
          priceCents: schema.products.priceCents,
          stock: schema.products.stock,
          status: schema.products.status,
          variantTitle: sql<string | null>`null`,
          variantSku: sql<string | null>`null`,
        })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(where)
      const variantRows = await db
        .select({
          kind: sql<string>`'variant'`,
          title: schema.products.title,
          slug: schema.products.slug,
          brand: schema.products.brand,
          condition: schema.products.condition,
          priceCents: schema.productVariants.priceCents,
          stock: schema.productVariants.stock,
          status: schema.productVariants.status,
          variantTitle: schema.productVariants.title,
          variantSku: schema.productVariants.sku,
        })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(where)
      const all = [...rows, ...variantRows]
      const header =
        "row_kind,title,slug,brand,condition,price_cents,stock,status,variant_title,variant_sku"
      const esc = (v: unknown) => {
        const str = v === null || v === undefined ? "" : String(v)
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
      }
      const body = all
        .map((r) =>
          [r.kind, r.title, r.slug, r.brand, r.condition, r.priceCents, r.stock, r.status, r.variantTitle, r.variantSku]
            .map(esc)
            .join(","),
        )
        .join("\n")
      const csv = `\uFEFF${header}\n${body}\n`
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    } catch (err) {
      if (err instanceof AppError) {
        return Response.json(
          { ok: false, error: { code: err.code, message: err.message } },
          { status: err.code === "UNAUTHORIZED" ? 401 : 403 },
        )
      }
      return Response.json(
        { ok: false, error: { code: "INTERNAL", message: "Export failed" } },
        { status: 500 },
      )
    }
  },
)
