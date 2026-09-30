/** Page numbers from untrusted input: finite integers ≥ 1 (L6 — a
 * non-numeric page used to become a NaN OFFSET and a 500). */
export function toPage(value: unknown): number {
  const n = Math.floor(Number(value ?? 1))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1
}

/** Page size of the admin/seller/buyer list screens (README #6). */
export const LIST_PAGE_SIZE = 50

export function pageInput(input: unknown): { page: number } {
  return { page: toPage((input as { page?: unknown } | undefined)?.page) }
}
