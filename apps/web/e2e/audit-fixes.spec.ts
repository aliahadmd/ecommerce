import { test, expect, request } from "@playwright/test"
import type { Page } from "@playwright/test"
import { login, registerAndLogin, slowFillLabel } from "./helpers"

/**
 * Regression specs for the 2026-09-30 audit fixes (plans/audit-2026-09-30.md).
 * Same prereqs as phase2.spec.ts, plus the job worker (`pnpm worker`) for the
 * email assertion.
 */

async function checkoutBottle(page: Page, name: string, method: "cod" | "card") {
  await page.goto("/products/insulated-water-bottle-750ml")
  await page.waitForTimeout(4000)
  await page.getByRole("button", { name: "750ml", exact: true }).click()
  await page.getByRole("button", { name: /Add to cart/ }).click()
  await page.waitForTimeout(1500)
  await page.goto("/cart")
  await page.getByRole("link", { name: "Checkout" }).click()
  await page.waitForTimeout(1000)
  await page.getByRole("button", { name: "+ New address" }).click()
  await slowFillLabel(page, "Full name *", name)
  await slowFillLabel(page, "Phone *", "+1-555-0900")
  await slowFillLabel(page, "Address line 1 *", "1 Audit Way")
  await slowFillLabel(page, "City *", "Berkeley")
  await slowFillLabel(page, "Country code *", "US")
  await page.getByRole("button", { name: "Save address" }).click()
  await expect(page.getByText("Address added")).toBeVisible({ timeout: 10_000 })
  if (method === "card") {
    await expect(async () => {
      await page.getByRole("button", { name: "Card", exact: true }).click()
      await expect(page.getByRole("button", { name: /pay by card/ })).toBeVisible()
    }).toPass({ timeout: 20_000 })
    await page.getByRole("button", { name: /pay by card/ }).click()
    await page.waitForURL("**/pay/**", { timeout: 15_000 })
  } else {
    await page.getByRole("button", { name: /Place order/ }).click()
    await expect(page.getByText(/placed — pay cash on delivery/)).toBeVisible({
      timeout: 15_000,
    })
  }
}

/** Click a fake-gateway button once the page is hydrated; wait for settle. */
async function gateway(page: Page, button: "Pay now" | "Simulate failure") {
  await page.waitForTimeout(3000) // hydration (same budget as phase2 specs)
  await Promise.all([
    page.waitForResponse("**/api/payments/callback", { timeout: 20_000 }),
    page.getByRole("button", { name: button }).click(),
  ])
}

async function signOut(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(name) }).click()
  await page.getByText("Sign out").click()
  await page.waitForTimeout(1500)
}

async function mailpitSubjectsFor(email: string): Promise<string[]> {
  const ctx = await request.newContext()
  const res = await ctx.get("http://localhost:8025/api/v1/messages?limit=100")
  const data = (await res.json()) as {
    messages: { Subject: string; To: { Address: string }[] }[]
  }
  await ctx.dispose()
  return data.messages
    .filter((m) => m.To.some((t) => t.Address === email))
    .map((m) => m.Subject)
}

test("COD: parent status follows sub-orders (H3), cash received (UI), order email queued", async ({ page }) => {
  test.setTimeout(150_000)
  const name = "Hana Status"
  const email = await registerAndLogin(page, name)
  await checkoutBottle(page, name, "cod")
  const orderUrl = page.url()
  const orderNumber = (await page.locator("h3, [data-slot=card-title]").first().innerText())
    .match(/ORD-\S+/)?.[0]
  expect(orderNumber).toBeTruthy()

  // queue fix: the order_placed email reaches Mailpit via the worker
  await expect
    .poll(async () => (await mailpitSubjectsFor(email)).join(" | "), { timeout: 30_000 })
    .toContain(orderNumber!)

  await signOut(page, name)
  await login(page, "seller@dev.local", "Seller1234!")
  await page.goto("/seller/orders")
  await page.waitForTimeout(1500)
  const row = page.getByRole("row", { name: new RegExp(orderNumber!) })
  await row.getByRole("button", { name: "Confirm" }).click()
  await page.waitForTimeout(800)
  await row.getByRole("button", { name: "Ship" }).click()
  await page.waitForTimeout(1000)

  // H3: the buyer's order now reads "shipped", not "pending"
  await signOut(page, "Ada Seller")
  await login(page, email, "Passw0rd123")
  await page.goto(orderUrl.replace("http://localhost:3000", ""))
  await page.waitForTimeout(1500)
  await expect(page.getByText("shipped").first()).toBeVisible()

  // seller delivers and records the cash
  await signOut(page, name)
  await login(page, "seller@dev.local", "Seller1234!")
  await page.goto("/seller/orders")
  await page.waitForTimeout(1500)
  await row.getByRole("button", { name: "Mark delivered" }).click()
  await page.waitForTimeout(1000)
  await row.getByRole("button", { name: "Cash received" }).click()
  await expect(page.getByText("Cash payment recorded")).toBeVisible({ timeout: 10_000 })
})

test("card: failed payment can be retried (plan 002) and seller can't fulfil unpaid (H5)", async ({ page }) => {
  test.setTimeout(150_000)
  const name = "Rita Retry"
  const email = await registerAndLogin(page, name)
  await checkoutBottle(page, name, "card")
  await gateway(page, "Simulate failure")

  await page.goto("/account/orders")
  await page.waitForTimeout(1500)
  await page.getByRole("link", { name: /ORD-/ }).first().click()
  await page.waitForTimeout(1500)
  const orderNumber = (await page.locator("[data-slot=card-title]").first().innerText())
    .match(/ORD-\S+/)?.[0]

  // H5: while unpaid, the seller sees "Awaiting card payment", no Confirm
  const orderUrl = page.url()
  await signOut(page, name)
  await login(page, "seller@dev.local", "Seller1234!")
  await page.goto("/seller/orders")
  await page.waitForTimeout(1500)
  const row = page.getByRole("row", { name: new RegExp(orderNumber!) })
  await expect(row.getByText("Awaiting card payment")).toBeVisible()
  await expect(row.getByRole("button", { name: "Confirm" })).toHaveCount(0)

  // plan 002: the buyer retries and pays
  await signOut(page, "Ada Seller")
  await login(page, email, "Passw0rd123")
  await page.goto(orderUrl.replace("http://localhost:3000", ""))
  await page.waitForTimeout(1500)
  await page.waitForTimeout(2000)
  await page.getByRole("button", { name: "Retry payment" }).click()
  await page.waitForURL("**/pay/**", { timeout: 15_000 })
  await gateway(page, "Pay now")
  await page.waitForURL("**/account/orders", { timeout: 15_000 })
  await page.goto(orderUrl.replace("http://localhost:3000", ""))
  await page.waitForTimeout(1500)
  await expect(page.getByText("paid").first()).toBeVisible()
  await expect(page.getByText("confirmed").first()).toBeVisible()
})

test("card: cancelling kills the payment — paying afterwards can't resurrect (plan 003)", async ({ page }) => {
  test.setTimeout(150_000)
  const name = "Cate Cancel"
  await registerAndLogin(page, name)
  await checkoutBottle(page, name, "card")
  const payUrl = page.url().replace("http://localhost:3000", "")

  await page.goto("/account/orders")
  await page.waitForTimeout(1500)
  await page.getByRole("link", { name: /ORD-/ }).first().click()
  await page.waitForTimeout(1500)
  const orderUrl = page.url().replace("http://localhost:3000", "")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByPlaceholder(/Reason/).fill("Changed my mind")
  await page.getByRole("button", { name: "Cancel sub-order" }).click()
  await page.waitForTimeout(1500)

  // the stale gateway page is dead: paying does not confirm the order
  await page.goto(payUrl)
  await gateway(page, "Pay now")
  await page.goto(orderUrl)
  await page.waitForTimeout(1500)
  await expect(page.getByText("cancelled").first()).toBeVisible()
  await expect(page.getByText("paid", { exact: true })).toHaveCount(0)
})
