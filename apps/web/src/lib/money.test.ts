import { describe, expect, it } from "vitest"
import { centsToDecimalString, formatMoney, parsePriceToCents, slugify } from "@ecommerce/config"

describe("parsePriceToCents", () => {
  it("parses decimal strings into integer cents", () => {
    expect(parsePriceToCents("12.34")).toBe(1234)
    expect(parsePriceToCents("12.3")).toBe(1230)
    expect(parsePriceToCents("12")).toBe(1200)
    expect(parsePriceToCents("0.99")).toBe(99)
    expect(parsePriceToCents(" 42.50 ")).toBe(4250)
  })
  it("rejects invalid input", () => {
    expect(parsePriceToCents("")).toBeNull()
    expect(parsePriceToCents("abc")).toBeNull()
    expect(parsePriceToCents("12.345")).toBeNull()
    expect(parsePriceToCents("-5")).toBeNull()
    expect(parsePriceToCents("1,234")).toBeNull()
  })
})

describe("formatMoney", () => {
  it("formats cents as currency", () => {
    expect(formatMoney(1234, "USD")).toBe("$12.34")
    expect(formatMoney(0, "USD")).toBe("$0.00")
    expect(formatMoney(100000, "USD")).toBe("$1,000.00")
  })
})

describe("centsToDecimalString", () => {
  it("round-trips with parsePriceToCents", () => {
    for (const cents of [1, 99, 1250, 100000]) {
      expect(parsePriceToCents(centsToDecimalString(cents))).toBe(cents)
    }
  })
})

describe("slugify", () => {
  it("kebab-cases names", () => {
    expect(slugify("Wireless Mechanical Keyboard")).toBe("wireless-mechanical-keyboard")
    expect(slugify("  Héllo Wörld!  ")).toBe("hello-world")
    expect(slugify("A  B---C")).toBe("a-b-c")
  })
})
