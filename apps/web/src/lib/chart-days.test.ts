import { describe, expect, it } from "vitest"
import { fillDays } from "./chart-days"

describe("fillDays", () => {
  const now = new Date("2026-10-02T15:00:00Z")
  it("returns one point per day ending today", () => {
    const out = fillDays([], 30, now)
    expect(out).toHaveLength(30)
    expect(out[0].day).toBe("09-03")
    expect(out[29].day).toBe("10-02")
    expect(out.every((p) => p.orders === 0)).toBe(true)
  })
  it("keeps counts on their days", () => {
    const out = fillDays([{ day: "2026-10-01", count: 3 }], 7, now)
    expect(out.find((p) => p.day === "10-01")?.orders).toBe(3)
    expect(out.reduce((n, p) => n + p.orders, 0)).toBe(3)
  })
})
