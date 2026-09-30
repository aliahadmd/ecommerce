import { expect, request } from "@playwright/test"
import type {Page, Locator} from "@playwright/test";

/**
 * Dev-mode TanStack Form relies on real key events for onChange validation;
 * Playwright's fill() doesn't always trigger them before submit. Type slowly.
 */
export async function slowFill(locator: Locator, value: string) {
  await locator.click()
  await locator.pressSequentially(value, { delay: 10 })
}

export async function slowFillLabel(page: Page, label: string, value: string) {
  await slowFill(page.getByRole("textbox", { name: label }), value)
}

const MAILPIT = "http://localhost:8025"

/** Extract the newest verification link for an email from Mailpit's API. */
export async function getVerificationLink(email: string): Promise<string> {
  const ctx = await request.newContext()
  const res = await ctx.get(`${MAILPIT}/api/v1/messages?limit=20`)
  const data = (await res.json()) as {
    messages: { ID: string; To: { Address: string }[] }[]
  }
  const mail = data.messages.find((m) =>
    m.To.some((t) => t.Address === email),
  )
  if (!mail) throw new Error(`No Mailpit message for ${email}`)
  const detail = await ctx.get(`${MAILPIT}/api/v1/message/${mail.ID}`)
  const body = (await detail.json()) as { HTML?: string; Text?: string }
  const source = body.HTML ?? body.Text ?? ""
  const match = source.match(/http:\/\/localhost:3000\/api\/auth\/verify-email[^"\s<]*/)
  await ctx.dispose()
  if (!match) throw new Error("No verification link in email")
  // the HTML email escapes ampersands (&amp;) — unescape before navigating
  return match[0].replace(/&amp;/g, "&")
}

export const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

export async function registerAndLogin(
  page: Page,
  name: string,
): Promise<string> {
  const email = `${unique()}@e2e.local`
  await page.goto("/register")
  await page.waitForTimeout(4000)
  await slowFillLabel(page, "Name", name)
  await slowFillLabel(page, "Email", email)
  await slowFillLabel(page, "Password", "Passw0rd123")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByText("Check your email")).toBeVisible({ timeout: 10_000 })
  const link = await getVerificationLink(email)
  await page.goto(link.replace("http://localhost:3000", ""))
  await page.waitForTimeout(2500)
  return email
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.waitForTimeout(3000)
  await slowFillLabel(page, "Email", email)
  await slowFillLabel(page, "Password", password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(2000)
}
