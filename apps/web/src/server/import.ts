import { createServerFn } from "@tanstack/react-start"
import { db, schema, eq } from "@ecommerce/db"
import { getRedis } from "@ecommerce/redis"
import { slugify, slugWithSuffix } from "@ecommerce/config"
import { AppError, guard, requireRole } from "./session"

const IMPORT_TTL = 60 * 60 * 24 // 24h
const MAX_ROWS = 1000

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
}

interface StagedRow {
  row: ParsedRow
  ok: boolean
  reason?: string
}


function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").trim()
  if (!clean) return []
  const first = clean.split("\n")[0]
  const delimiter =
    (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ","
  const lines: string[][] = []
  let cur: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '""'
        i++
      } else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delimiter) {
      cur.push(field)
      field = ""
    } else if (ch === "\n") {
      cur.push(field)
      lines.push(cur)
      cur = []
      field = ""
    } else field += ch
  }
  cur.push(field)
  lines.push(cur)
  const headers = (lines.shift() ?? []).map((h) => h.trim().toLowerCase())
  return lines
    .filter((l) => l.some((c) => c.trim() !== ""))
    .map((l) => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => (obj[h] = (l[i] ?? "").trim()))
      return obj
    })
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
  return {
    rowNumber,
    kind: kind as "product" | "variant",
    title: r.title,
    slug: r.slug || slugify(r.title),
    brand: r.brand || null,
    condition: ["new", "used", "refurbished"].includes(r.condition)
      ? r.condition
      : "new",
    priceCents,
    stock,
    status: ["draft", "active", "archived"].includes(r.status) ? r.status : "draft",
    variantTitle: r.variant_title || null,
    variantSku: r.variant_sku || null,
  }
}

/** Parse + validate + stage the CSV in Redis. Returns a summary. */
export const stageImport = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as FormData)
  .handler(async ({ data }: { data: FormData }) => {
    try {
      await requireRole("seller", "super_admin")
      const file = data.get("file")
      if (!(file instanceof File)) {
        throw new AppError("INVALID", "No file provided")
      }
      if (file.size > 2 * 1024 * 1024) {
        throw new AppError("INVALID", "CSV must be 2MB or smaller")
      }
      const text = await file.text()
      const raw = parseCsv(text)
      if (raw.length === 0 || raw.length > MAX_ROWS) {
        throw new AppError("INVALID", `CSV must have 1–${MAX_ROWS} rows`)
      }

      const staged: StagedRow[] = []
      const errors: { row: number; reason: string }[] = []
      raw.forEach((r, i) => {
        const parsed = rowToParsed(i + 2, r) // +2: header + 1-indexed
        if ("error" in parsed) errors.push({ row: i + 2, reason: parsed.error })
        else staged.push({ row: parsed, ok: true })
      })

      const user = await requireRole("seller", "super_admin")
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
    } catch (err) {
      if (err instanceof AppError) throw err
      console.error("[import] stage failed:", err)
      throw new AppError("INTERNAL", "Import staging failed")
    }
  }
)

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

      const raw = await getRedis().get(`import:${user.id}:${data.importId}`)
      if (!raw) throw new AppError("NOT_FOUND", "Import expired — re-upload the file")
      const { staged }: { staged: { row: ParsedRow; ok: boolean }[] } = JSON.parse(raw)

      let created = 0
      // variant rows attach to the most recent product row (export shape)
      let lastProductId: string | null = null
      for (const { row } of staged) {
        if (row.kind === "product") {
          let slug = row.slug
          const [taken] = await db
            .select({ id: schema.products.id })
            .from(schema.products)
            .where(eq(schema.products.slug, slug))
            .limit(1)
          if (taken) slug = slugWithSuffix(slug)
          const [product] = await db
            .insert(schema.products)
            .values({
              shopId: shop.id,
              title: row.title,
              slug,
              description: `Imported product ${row.title}.`,
              brand: row.brand,
              condition: row.condition as "new" | "used" | "refurbished",
              priceCents: row.priceCents,
              stock: row.stock,
              status: "draft",
            })
            .returning({ id: schema.products.id })
          lastProductId = product.id
          created++
        } else {
          // variant row: attach to the preceding product
          if (!lastProductId) {
            continue
          }
          const sku = row.variantSku || `IMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
          await db.insert(schema.productVariants).values({
            productId: lastProductId,
            sku,
            title: row.variantTitle || row.title,
            priceCents: row.priceCents,
            stock: row.stock,
            status: "draft",
          }).onConflictDoNothing()
        }
      }
      // clear the staged data
      await getRedis().del(`import:${user.id}:${data.importId}`)
      return { created }
    }),
  )

