import { createServerFn } from "@tanstack/react-start"
import { db, schema, eq, inArray } from "@ecommerce/db"
import { getRedis } from "@ecommerce/redis"
import { getEnv, slugify, slugWithSuffix } from "@ecommerce/config"
import { parseCsv } from "@/lib/csv"
import { AppError, guard, requireRole } from "./session"

const IMPORT_TTL = 60 * 60 * 24 // 24h
const MAX_ROWS = 1000
const MAX_BYTES = 2 * 1024 * 1024

interface ParsedRow {
  rowNumber: number
  kind: "product" | "variant"
  title: string
  slug: string
  brand: string | null
  condition: string
  priceCents: number
  stock: number
  status: string
  variantTitle: string | null
  variantSku: string | null
  description: string | null
  category: string | null
}

interface StagedRow {
  row: ParsedRow
  ok: boolean
  reason?: string
}

function rowToParsed(rowNumber: number, r: Record<string, string>): ParsedRow | { error: string } {
  const kind = (r.row_kind || "product").toLowerCase()
  if (!["product", "variant"].includes(kind)) {
    return { error: `invalid row_kind "${kind}"` }
  }
  if (!r.title || r.title.length < 3) return { error: "title required (3+ chars)" }
  const priceCents = Math.round(Number(r.price_cents || "0"))
  if (!Number.isFinite(priceCents) || priceCents <= 0) {
    return { error: "price_cents must be > 0" }
  }
  const stock = Number(r.stock || "0")
  if (!Number.isInteger(stock) || stock < 0) {
    return { error: "stock must be a non-negative integer" }
  }
  if (r.status && !["draft", "active", "archived"].includes(r.status)) {
    return { error: `invalid status "${r.status}"` }
  }
  if (r.variant_sku && !/^[A-Za-z0-9-]{3,40}$/.test(r.variant_sku)) {
    return { error: "variant_sku: 3–40 letters, digits, dashes" }
  }
  return {
    rowNumber,
    kind: kind as "product" | "variant",
    title: r.title.slice(0, 200),
    slug: slugify(r.slug || r.title),
    brand: r.brand ? r.brand.slice(0, 80) : null,
    condition: ["new", "used", "refurbished"].includes(r.condition)
      ? r.condition
      : "new",
    priceCents,
    stock,
    status: ["draft", "active", "archived"].includes(r.status) ? r.status : "draft",
    variantTitle: r.variant_title ? r.variant_title.slice(0, 120) : null,
    variantSku: r.variant_sku || null,
    description: r.description && r.description.length >= 10 ? r.description.slice(0, 5000) : null,
    category: r.category || null,
  }
}

/** Parse + validate + stage the CSV in Redis. Returns a dry-run summary. */
export const stageImport = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) throw new AppError("INVALID", "Upload a CSV file")
    return input
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const file = data.get("file")
      if (!(file instanceof File)) {
        throw new AppError("INVALID", "No file provided")
      }
      if (file.size > MAX_BYTES) {
        throw new AppError("INVALID", "CSV must be 2MB or smaller")
      }
      const raw = parseCsv(await file.text())
      if (raw.length === 0 || raw.length > MAX_ROWS) {
        throw new AppError("INVALID", `CSV must have 1–${MAX_ROWS} rows`)
      }

      const staged: StagedRow[] = []
      const errors: { row: number; reason: string }[] = []
      const skusInFile = new Set<string>()
      let sawProduct = false
      raw.forEach((r, i) => {
        const rowNumber = i + 2 // +2: header + 1-indexed
        const parsed = rowToParsed(rowNumber, r)
        if ("error" in parsed) {
          errors.push({ row: rowNumber, reason: parsed.error })
          return
        }
        if (parsed.kind === "product") sawProduct = true
        else if (!sawProduct) {
          errors.push({ row: rowNumber, reason: "variant row has no product row above it" })
          return
        }
        if (parsed.variantSku) {
          const key = parsed.variantSku.toUpperCase()
          if (skusInFile.has(key)) {
            errors.push({ row: rowNumber, reason: `duplicate variant_sku "${parsed.variantSku}"` })
            return
          }
          skusInFile.add(key)
        }
        staged.push({ row: parsed, ok: true })
      })

      // SKUs already in the catalog would collide on the unique index
      const skus = staged.map((s) => s.row.variantSku).filter((s): s is string => !!s)
      if (skus.length > 0) {
        const taken = await db
          .select({ sku: schema.productVariants.sku })
          .from(schema.productVariants)
          .where(inArray(schema.productVariants.sku, skus))
        const takenSet = new Set(taken.map((t) => t.sku))
        for (let i = staged.length - 1; i >= 0; i--) {
          const sku = staged[i].row.variantSku
          if (sku && takenSet.has(sku)) {
            errors.push({ row: staged[i].row.rowNumber, reason: `variant_sku "${sku}" already exists` })
            staged.splice(i, 1)
          }
        }
        errors.sort((a, b) => a.row - b.row)
      }

      const importId = `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      await getRedis().set(
        `import:${user.id}:${importId}`,
        JSON.stringify({ staged, errors }),
        "EX",
        IMPORT_TTL
      )
      return {
        importId,
        total: raw.length,
        valid: staged.length,
        errorCount: errors.length,
        errors: errors.slice(0, 20),
      }
    })
  )

/**
 * Commit a staged import in ONE transaction — bad rows never half-import
 * (README #11). Products are created as drafts; variant rows attach to the
 * product row above them (the export writes them in that order).
 */
export const commitImport = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const importId = String((input as { importId?: unknown })?.importId ?? "")
    if (!importId) throw new AppError("INVALID", "importId required")
    return { importId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [shop] = await db
        .select({ id: schema.shops.id })
        .from(schema.shops)
        .where(eq(schema.shops.ownerId, user.id))
        .limit(1)
      if (!shop) throw new AppError("FORBIDDEN", "Create your shop first")

      const key = `import:${user.id}:${data.importId}`
      const raw = await getRedis().get(key)
      if (!raw) throw new AppError("NOT_FOUND", "Import expired — re-upload the file")
      const { staged }: { staged: StagedRow[] } = JSON.parse(raw)

      const categorySlugs = [
        ...new Set(staged.map((s) => s.row.category).filter((c): c is string => !!c)),
      ]
      const categories = categorySlugs.length
        ? await db
            .select({ id: schema.categories.id, slug: schema.categories.slug })
            .from(schema.categories)
            .where(inArray(schema.categories.slug, categorySlugs))
        : []
      const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]))
      const currency = getEnv().CURRENCY

      const { recomputeProductAggregates } = await import("./internals")
      const result = await db.transaction(async (tx) => {
        let created = 0
        let variants = 0
        let lastProductId: string | null = null
        const withVariants = new Set<string>()
        for (const { row } of staged) {
          if (row.kind === "product") {
            let slug = row.slug
            const [taken] = await tx
              .select({ id: schema.products.id })
              .from(schema.products)
              .where(eq(schema.products.slug, slug))
              .limit(1)
            if (taken) slug = slugWithSuffix(slug)
            const [product] = await tx
              .insert(schema.products)
              .values({
                shopId: shop.id,
                title: row.title,
                slug,
                description: row.description ?? `Imported product ${row.title}.`,
                categoryId: row.category ? (categoryBySlug.get(row.category) ?? null) : null,
                brand: row.brand,
                condition: row.condition as "new" | "used" | "refurbished",
                priceCents: row.priceCents,
                currency,
                stock: row.stock,
                status: "draft",
              })
              .returning({ id: schema.products.id })
            lastProductId = product.id
            created++
          } else if (lastProductId) {
            const sku =
              row.variantSku ||
              `IMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
            await tx.insert(schema.productVariants).values({
              productId: lastProductId,
              sku,
              title: row.variantTitle || row.title,
              priceCents: row.priceCents,
              stock: row.stock,
              status: "draft",
            })
            withVariants.add(lastProductId)
            variants++
          }
        }
        // variant products derive price/stock from their variants
        for (const pid of withVariants) {
          await recomputeProductAggregates(tx, pid)
        }
        return { created, variants }
      })
      await getRedis().del(key)
      return result
    }),
  )
