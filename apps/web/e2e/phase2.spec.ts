import { test, expect  } from "@playwright/test"
import { login, registerAndLogin, slowFillLabel } from "./helpers"

/**
 * Phase-2 e2e smoke: runs against a dev server + seeded data.
 * Prereqs: make up && make migrate && make seed && make dev
 *
 * Each scenario registers its own user (verified via Mailpit) so cart/order
 * state never bleeds between tests.
 */

test("register → verify → logged in", async ({ page }) => {
  const email = await registerAndLogin(page, "E2E Shopper")
  // signed in: the account menu shows the user's initial + name
  await expect(page.getByRole("button", { name: /E E2E/ })).toBeVisible({
    timeout: 10_000,
  })
  void email
})

test("browse → filter → open product with specs", async ({ page }) => {
  await page.goto("/products?category=electronics")
  await expect(page.getByText(/results/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole("link", { name: /Wireless Mechanical Keyboard/ }).first().click()
  await expect(
    page.getByRole("heading", { name: /Wireless Mechanical Keyboard/ }),
  ).toBeVisible({ timeout: 15_000 })
})

test("variants: pick options → add to cart → cart shows variant", async ({ page }) => {
  test.setTimeout(60_000)
  await registerAndLogin(page, "Vera Variant")
  await page.goto("/products/merino-wool-beanie")
  await page.waitForTimeout(4000)
  await page.getByRole("button", { name: "M", exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole("button", { name: "Olive", exact: true }).click()
  await page.waitForTimeout(500)
  const add = page.getByRole("button", { name: /Add to cart/ })
  await expect(add).toBeEnabled({ timeout: 10_000 })
  await add.click()
  await page.waitForTimeout(1500)
  await page.goto("/cart")
  await expect(page.getByText(/M \/ Olive/)).toBeVisible({ timeout: 15_000 })
})

test("wishlist: heart → wishlist page shows item", async ({ page }) => {
  await registerAndLogin(page, "Willy Wishlist")
  await page.goto("/products/ceramic-pour-over-coffee-set")
  await page.waitForTimeout(3000)
  await page.getByRole("button", { name: "Save to wishlist" }).first().click({ force: true })
  await page.waitForTimeout(1000)
  await page.goto("/account/wishlist")
  await expect(page.getByText(/Ceramic Pour-Over/i)).toBeVisible({ timeout: 15_000 })
})

test("review: purchase → deliver → post review → visible", async ({ page }) => {
  test.setTimeout(120_000)
  // fresh user buys a single-SKU product
  const email = await registerAndLogin(page, "Rita Review")
  await page.goto("/products/argan-oil-hair-mask")
  await page.waitForTimeout(4000)
  await page.getByRole("button", { name: /Add to cart/ }).click()
  await page.waitForTimeout(1500)
  await page.goto("/cart")
  await page.getByRole("link", { name: "Checkout" }).click()
  await page.waitForTimeout(1000)
  await page.getByRole("button", { name: "+ New address" }).click()
  await slowFillLabel(page, "Full name *", "Rita Review")
  await slowFillLabel(page, "Phone *", "+1-555-0500")
  await slowFillLabel(page, "Address line 1 *", "5 Review Road")
  await slowFillLabel(page, "City *", "Berkeley")
  await slowFillLabel(page, "Country code *", "US")
  await page.getByRole("button", { name: "Save address" }).click()
  await expect(page.getByText("Address added")).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: /Place order/ }).click()
  await expect(page.getByText(/placed — pay cash on delivery/)).toBeVisible({
    timeout: 15_000,
  })
  await page.waitForTimeout(1000)
  const ordText = await page
    .getByText(/ORD-/)
    .first()
    .innerText()
  const orderNumber = ordText.match(/ORD-[0-9A-Z-]+/)?.[0]
  expect(orderNumber, `order number from: ${ordText}`).toBeTruthy()

  // seller delivers it (target this exact order's row)
  await login(page, "seller@dev.local", "Seller1234!")
  await page.goto("/seller/orders")
  await page.waitForTimeout(1500)
  const row = page.locator("tr", { hasText: orderNumber! }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.getByRole("button", { name: "Confirm" }).click()
  await page.waitForTimeout(800)
  await row.getByRole("button", { name: "Ship" }).click()
  await page.waitForTimeout(800)
  await row.getByRole("button", { name: "Mark delivered" }).click()
  await page.waitForTimeout(1000)

  // buyer reviews the delivered product
  await login(page, email, "Passw0rd123")
  await page.goto("/products/argan-oil-hair-mask")
  await page.waitForTimeout(4000)
  const writeButton = page.getByRole("button", { name: "Write a review" })
  await expect(writeButton).toBeVisible({ timeout: 10_000 })
  await writeButton.click()
  const title = `E2E review ${Date.now()}`
  await slowFillLabel(page, "Title", title)
  await slowFillLabel(
    page,
    "Your review",
    "Automated end-to-end verification review of this product.",
  )
  await page.getByRole("button", { name: "Post review" }).click()
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 })
})

test("order: buyer checkout → seller fulfills", async ({ page }) => {
  test.setTimeout(90_000)
  await registerAndLogin(page, "Olga Order")
  await page.goto("/products/insulated-water-bottle-750ml")
  await page.waitForTimeout(4000)
  await page.getByRole("button", { name: "750ml", exact: true }).click()
  await page.getByRole("button", { name: /Add to cart/ }).click()
  await page.waitForTimeout(1500)
  await page.goto("/cart")
  await page.getByRole("link", { name: "Checkout" }).click()
  await page.waitForTimeout(1000)

  // fresh user: add an address inline
  await page.getByRole("button", { name: "+ New address" }).click()
  await slowFillLabel(page, "Full name *", "Olga Order")
  await slowFillLabel(page, "Phone *", "+1-555-0400")
  await slowFillLabel(page, "Address line 1 *", "9 Test Lane")
  await slowFillLabel(page, "City *", "Oakland")
  await slowFillLabel(page, "Country code *", "US")
  await page.getByRole("button", { name: "Save address" }).click()
  await expect(page.getByText("Address added")).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: /Place order/ }).click()
  await expect(page.getByText(/placed — pay cash on delivery/)).toBeVisible({
    timeout: 15_000,
  })

  // seller fulfills
  await page.getByRole("button", { name: /Olga Order/ }).click()
  await page.getByText("Sign out").click()
  await page.waitForTimeout(1500)
  await login(page, "seller@dev.local", "Seller1234!")
  await page.goto("/seller/orders")
  await page.waitForTimeout(1500)
  await page.getByRole("button", { name: "Confirm" }).first().click()
  await page.waitForTimeout(800)
  await page.getByRole("button", { name: "Ship" }).first().click()
  await page.waitForTimeout(800)
  await page.getByRole("button", { name: "Mark delivered" }).first().click()
  await page.waitForTimeout(1000)
  await expect(page.getByText("delivered").first()).toBeVisible()
})

test("facets: click attribute facet → URL updates → filtered results", async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto("/products?category=fashion")
  await page.waitForTimeout(3000)
  // Material facet should list Merino (seeded on the beanie)
  const materialLabel = page.locator("aside label", { hasText: "Merino" }).first()
  await expect(materialLabel).toBeVisible({ timeout: 10_000 })
  await materialLabel.locator("button, input, [role=checkbox], [data-slot=checkbox]").first().click({ force: true })
  await page.waitForTimeout(2500)
  await expect(page.getByText(/results/)).toBeVisible({ timeout: 15_000 })
  // the filtered page must not error and must include the beanie
  await expect(page.getByText(/Merino Wool Beanie/).first()).toBeVisible({ timeout: 15_000 })
})

test("seller: generate variants from type axes", async ({ page }) => {
  test.setTimeout(90_000)
  // fresh user opens a shop, creates a product of an axe type, generates variants
  await registerAndLogin(page, "Gabe Generate")
  await page.goto("/seller/onboarding")
  await page.waitForTimeout(2000)
  await page.getByLabel("Shop name").fill("Variant Forge")
  await page.getByRole("button", { name: "Create shop" }).click()
  await expect(page.getByText(/welcome aboard/i)).toBeVisible({ timeout: 15_000 })
  await page.goto("/seller/products/new")
  await page.waitForTimeout(2000)
  await page.locator("#title").fill("Forge Test Tee")
  await page.locator("#price").fill("18")
  await page.locator("#stock").fill("30")
  await page.locator("#description").fill("A generated-variant test product for the e2e suite.")
  // pick the Apparel type (has Size + Color axes)
  const typeTrigger = page.getByText("Product type").locator("..").getByRole("combobox").first()
  await typeTrigger.click()
  await page.getByRole("option", { name: "Apparel" }).click()
  await page.waitForTimeout(500)
  await page.getByRole("button", { name: "Create product" }).click()
  await expect(page.getByText(/Product created/)).toBeVisible({ timeout: 15_000 })
  // on the edit page: generate variants
  await page.getByRole("button", { name: "Generate combinations" }).click()
  await expect(page.getByText(/variant\(s\) generated/)).toBeVisible({ timeout: 15_000 })
  // cart shows variant rows
  await expect(page.getByText("S / Black").first()).toBeVisible({ timeout: 10_000 })
})

test("card payment: fake gateway → order confirmed → paid", async ({ page }) => {
  test.setTimeout(90_000)
  await registerAndLogin(page, "Carl Card")
  await page.goto("/products/insulated-water-bottle-750ml")
  await page.waitForTimeout(4000)
  await page.getByRole("button", { name: "750ml", exact: true }).click()
  await page.getByRole("button", { name: /Add to cart/ }).click()
  await page.waitForTimeout(1500)
  await page.goto("/cart")
  await page.getByRole("link", { name: "Checkout" }).click()
  await page.waitForTimeout(1000)
  await page.getByRole("button", { name: "+ New address" }).click()
  await slowFillLabel(page, "Full name *", "Carl Card")
  await slowFillLabel(page, "Phone *", "+1-555-0700")
  await slowFillLabel(page, "Address line 1 *", "12 Charge Ave")
  await slowFillLabel(page, "City *", "Fremont")
  await slowFillLabel(page, "Country code *", "US")
  await page.getByRole("button", { name: "Save address" }).click()
  await expect(page.getByText("Address added")).toBeVisible({ timeout: 10_000 })
  // choose card (retry until the place-order label flips — hydration timing)
  await expect(async () => {
    await page.getByRole("button", { name: "Card", exact: true }).click()
    await expect(page.getByRole("button", { name: /pay by card/ })).toBeVisible()
  }).toPass({ timeout: 20_000 })
  await page.getByRole("button", { name: /pay by card/ }).click()
  // fake gateway page
  await page.waitForURL("**/pay/**", { timeout: 15_000 })
  await page.getByRole("button", { name: "Pay now" }).click()
  // should land on orders page with paid status
  await page.waitForTimeout(2000)
  await page.goto("/account/orders")
  await expect(page.getByText("paid").first()).toBeVisible({ timeout: 15_000 })
})

test("coupon: apply percent code → discount at checkout", async ({ page }) => {
  test.setTimeout(90_000)
  await registerAndLogin(page, "Cora Coupon")
  await page.goto("/products/wireless-mechanical-keyboard")
  await page.waitForTimeout(4000)
  await page.getByRole("button", { name: /Add to cart/ }).click()
  await page.waitForTimeout(1500)
  await page.goto("/cart")
  // type only once the cart page is hydrated (hydration resets the field;
  // CI runners are slow enough to hit that)
  const code = page.getByPlaceholder("Coupon code")
  await expect(async () => {
    await code.fill("E2E10")
    await page.waitForTimeout(300)
    await expect(code).toHaveValue("E2E10")
  }).toPass({ timeout: 20_000 })
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page.getByText(/Coupon E2E10 applied/).first()).toBeVisible({ timeout: 10_000 })
})
