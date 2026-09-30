/**
 * Pure CSV helpers shared by product export and import (unit-tested).
 */

const FORMULA_START = /^[=+\-@\t\r]/

/**
 * Serialize one cell. Text that a spreadsheet would evaluate as a formula is
 * prefixed with an apostrophe (M16 — seller-controlled titles end up in the
 * admin's export). Numbers are written as-is.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return String(value)
  let str = String(value)
  if (FORMULA_START.test(str)) str = `'${str}`
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

/** Undo csvCell's formula guard when reading our own export back. */
export function unguardCell(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1))
    ? value.slice(1)
    : value
}

/**
 * Parse CSV text into header-keyed rows. Handles quoted fields, escaped
 * quotes (`""` → `"`), CRLF line endings, a UTF-8 BOM, and `;` delimiters.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim()
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
        field += '"'
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
      headers.forEach((h, i) => (obj[h] = unguardCell((l[i] ?? "").trim())))
      return obj
    })
}
