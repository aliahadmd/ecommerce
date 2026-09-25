import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "@ecommerce/db"
import { getRedis } from "@ecommerce/redis"
import { parsePriceToCents, slugify, slugWithSuffix } from "@ecommerce/config"
import { AppError, guard, requireRole, requireUser } from "./session"

const PAGE_SIZE = 12

// ─── Public: categories & tags ───────────────────────────────────────────────

export const getCategories = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const rows = await db
      .select()
      .from(schema.categories)
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name))
    return rows
  }),
)

export const getTags = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    return db.select().from(schema.tags).orderBy(asc(schema.tags.name))
  }),
)

// ─── Admin: taxonomy management ─────────────────────────────────────────────

const categoryInput = (input: unknown) => {
  const parsed = (
    input as {
      name?: unknown
      description?: unknown
      parentId?: unknown
    }
  ) as { name: string; description?: string; parentId?: string | null }
  const name = String(parsed.name ?? "").trim()
  if (name.length < 2 || name.length > 80) {
    throw new AppError("INVALID", "Name must be 2–80 characters")
  }
  return {
    name,
    description: parsed.description ? String(parsed.description).slice(0, 500) : null,
    parentId: parsed.parentId || null,
  }
}

async function uniqueSlug(
  table: typeof schema.categories | typeof schema.tags,
  name: string,
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
      await getRedis().del("catalog:categories:v1")
      return row
    }),
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
      if (data.parentId === data.id) {
        throw new AppError("INVALID", "A category cannot be its own parent")
      }
      const [row] = await db
        .update(schema.categories)
        .set({ name: data.name, description: data.description, parentId: data.parentId })
        .where(eq(schema.categories.id, data.id))
        .returning()
      if (!row) throw new AppError("NOT_FOUND", "Category not found")
      await getRedis().del("catalog:categories:v1")
      return row
    }),
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
      const inUse = await db.$count(schema.products, eq(schema.products.categoryId, data.id))
      if (inUse > 0) {
        throw new AppError(
          "IN_USE",
          `Cannot delete — ${inUse} product(s) use this category. Reassign them first.`,
        )
      }
      await db.delete(schema.categories).where(eq(schema.categories.id, data.id))
      await getRedis().del("catalog:categories:v1")
      return { deleted: true }
    }),
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
      const [row] = await db.insert(schema.tags).values({ name: data.name, slug }).returning()
      return row
    }),
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
    }),
  )

// ─── Public: browse ─────────────────────────────────────────────────────────

export type ProductFilters = {
  q?: string
  category?: string
  tag?: string
  min?: number
  max?: number
  sort?: "newest" | "price-asc" | "price-desc"
  page?: number
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
    } satisfies ProductFilters
  })
  .handler(({ data }) =>
    guard(async () => {
      const conditions = [
        eq(schema.products.status, "active"),
        eq(schema.shops.status, "active"),
      ]
      if (data.q) {
        const like = `%${data.q}%`
        conditions.push(
          or(
            ilike(schema.products.title, like),
            ilike(schema.products.description, like),
          )!,
        )
      }
      if (data.category) conditions.push(eq(schema.categories.slug, data.category))
      if (data.tag) conditions.push(eq(schema.tags.slug, data.tag))
      if (data.min !== undefined) conditions.push(gte(schema.products.priceCents, Math.round(data.min * 100)))
      if (data.max !== undefined) conditions.push(lte(schema.products.priceCents, Math.round(data.max * 100)))

      const where = and(...conditions)

      const orderBy =
        data.sort === "price-asc"
          ? asc(schema.products.priceCents)
          : data.sort === "price-desc"
            ? desc(schema.products.priceCents)
            : desc(schema.products.createdAt)

      let query = db
        .select(productCardColumns)
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
        .$dynamic()

      if (data.tag) {
        query = query
          .innerJoin(schema.productTags, eq(schema.productTags.productId, schema.products.id))
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
        .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
        .$dynamic()
      if (data.tag) {
        countQuery = countQuery
          .innerJoin(schema.productTags, eq(schema.productTags.productId, schema.products.id))
          .innerJoin(schema.tags, eq(schema.productTags.tagId, schema.tags.id))
      }
      const [{ total }] = await countQuery.where(where)

      return { items, total, page: data.page, pageSize: PAGE_SIZE }
    }),
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
        .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
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
        .select({ id: schema.tags.id, name: schema.tags.name, slug: schema.tags.slug })
        .from(schema.productTags)
        .innerJoin(schema.tags, eq(schema.productTags.tagId, schema.tags.id))
        .where(eq(schema.productTags.productId, row.product.id))

      return { ...row, images, tags }
    }),
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
        .where(and(eq(schema.products.shopId, shop.id), eq(schema.products.status, "active")))
        .orderBy(desc(schema.products.createdAt))
        .limit(24)
      return { shop, items }
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
    }),
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
  const status: "active" | "draft" = raw.status === "active" ? "active" : "draft"
  const categoryId = raw.categoryId ? String(raw.categoryId) : null
  const tagIds = Array.isArray(raw.tagIds) ? (raw.tagIds as string[]).map(String) : []
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
  return { title, description, priceCents, stock, status, categoryId, tagIds }
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

      return db.transaction(async (tx) => {
        const [product] = await tx
          .insert(schema.products)
          .values({
            shopId: shop.id,
            categoryId: data.categoryId,
            title: data.title,
            slug,
            description: data.description,
            priceCents: data.priceCents,
            stock: data.stock,
            status: data.status,
          })
          .returning()
        if (data.tagIds.length > 0) {
          await tx
            .insert(schema.productTags)
            .values(data.tagIds.map((tagId) => ({ productId: product.id, tagId })))
            .onConflictDoNothing()
        }
        return { id: product.id, slug: product.slug }
      })
    }),
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
      return {
        product: row.product,
        ownerId: row.ownerId,
        images,
        tagIds: tags.map((t) => t.id),
      }
    }),
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
            title: data.title,
            description: data.description,
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
        return { id: product.id, slug: product.slug }
      })
    }),
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
    }),
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
      const where = data.status ? eq(schema.products.status, data.status) : undefined
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
    }),
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
      return db.select().from(schema.products).where(inArray(schema.products.id, data.ids))
    }),
  )
