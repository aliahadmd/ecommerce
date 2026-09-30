import { z } from "zod"
import { db, schema, eq } from "@ecommerce/db"
import { AppError } from "./session"

/**
 * SERVER-ONLY store settings record (plan-8). Single source of truth for the
 * settings key and shape — the admin page, the maintenance/sign-up gates and
 * the ledger's commission rate all read through here (H2: the ledger used to
 * read a different key that nothing ever wrote).
 */

export const SETTINGS_KEY = schema.STORE_SETTINGS_KEY

export interface StoreSettings {
  mode: "open" | "maintenance"
  signupsEnabled: boolean
  commissionRate: number // percent 0–50
  contactEmail: string
}

export const DEFAULT_SETTINGS: StoreSettings = {
  mode: "open",
  signupsEnabled: true,
  commissionRate: 10,
  contactEmail: "",
}

export const settingsSchema = z.object({
  mode: z.enum(["open", "maintenance"]),
  signupsEnabled: z.boolean(),
  commissionRate: z.number().int().min(0).max(50),
  contactEmail: z.union([z.literal(""), z.string().email()]),
})

type Executor = Pick<typeof db, "select">

export async function readStoreSettings(
  executor: Executor = db
): Promise<StoreSettings> {
  const [row] = await executor
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, SETTINGS_KEY))
    .limit(1)
  if (!row) return DEFAULT_SETTINGS
  const parsed = settingsSchema.safeParse(row.value)
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

/**
 * Maintenance mode is enforced on the purchase paths, not only in the UI
 * (M8): during maintenance nobody but a super admin can cart, check out or
 * pay.
 */
export async function assertStoreOpen(user: { role: string } | null): Promise<void> {
  if (user?.role === "super_admin") return
  const settings = await readStoreSettings()
  if (settings.mode === "maintenance") {
    throw new AppError(
      "MAINTENANCE",
      "The store is temporarily closed for maintenance — please try again later",
    )
  }
}
