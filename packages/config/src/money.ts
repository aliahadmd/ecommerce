/**
 * Money is always stored as integer minor units (cents) — never floats.
 * The only place cents become display strings is formatMoney.
 */
export function formatMoney(
  cents: number,
  currency = "USD",
  locale = "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100)
}

/** Parse a decimal string like "12.34" into integer cents. Returns null when invalid. */
export function parsePriceToCents(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, frac = ""] = trimmed.split(".")
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"))
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2)
}
