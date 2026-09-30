import { describe, expect, it } from "vitest"
import { csvCell, parseCsv } from "./csv"

describe("csvCell", () => {
  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell("+1")).toBe("'+1")
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(csvCell("-2")).toBe("'-2")
  })
  it("keeps numbers and plain text", () => {
    expect(csvCell(-250)).toBe("-250")
    expect(csvCell("Mug")).toBe("Mug")
    expect(csvCell(null)).toBe("")
    expect(csvCell("a,b")).toBe('"a,b"')
  })
})

describe("parseCsv", () => {
  it("unescapes doubled quotes", () => {
    const [row] = parseCsv('title\n"12"" Pizza"')
    expect(row.title).toBe('12" Pizza')
  })
  it("handles CRLF, BOM and quoted newlines", () => {
    const rows = parseCsv('﻿title,brand\r\n"two\nlines",Acme\r\n')
    expect(rows).toEqual([{ title: "two\nlines", brand: "Acme" }])
  })
  it("round-trips formula-guarded cells", () => {
    const text = `title\n${csvCell("=cmd")}\n`
    expect(parseCsv(text)[0].title).toBe("=cmd")
  })
  it("detects semicolon delimiters", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([{ a: "1", b: "2" }])
  })
})
