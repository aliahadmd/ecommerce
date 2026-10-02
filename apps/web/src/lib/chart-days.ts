/**
 * Zero-fill a sparse "orders per day" series to one point per day, so a
 * 30-day chart always has 30 slots (one active day used to stretch a single
 * bar across the whole chart). Days are UTC YYYY-MM-DD, matching the server.
 */
export function fillDays(
  rows: { day: string; count: number }[],
  days = 30,
  now: Date = new Date(),
): { day: string; orders: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.count]))
  const out: { day: string; orders: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    const key = d.toISOString().slice(0, 10)
    out.push({ day: key.slice(5), orders: byDay.get(key) ?? 0 })
  }
  return out
}
