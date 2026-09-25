import { createServerFn } from "@tanstack/react-start"
import { eq, db, schema } from "@ecommerce/db"
import { z } from "zod"
import { slugify, slugWithSuffix } from "@ecommerce/config"
import { isUniqueViolation } from "./catalog"
import { AppError, guard, requireUser } from "./session"

const createShopSchema = z.object({
  name: z.string().min(3).max(80),
  description: z.string().max(500).optional(),
})

export const createShop = createServerFn({ method: "POST" })
  .validator((input: unknown) => createShopSchema.parse(input))
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      if (!user.emailVerified) {
        throw new AppError(
          "EMAIL_UNVERIFIED",
          "Verify your email before opening a shop"
        )
      }
      if (user.role === "seller") {
        throw new AppError("ALREADY_SELLER", "You already have a shop")
      }
      if (user.role === "super_admin") {
        throw new AppError(
          "INVALID",
          "Admins cannot open a shop — have a super admin demote this account to buyer first",
        )
      }

      let slug = slugify(data.name)
      const [taken] = await db
        .select({ id: schema.shops.id })
        .from(schema.shops)
        .where(eq(schema.shops.slug, slug))
        .limit(1)
      if (taken) slug = slugWithSuffix(slug)

      let shop
      try {
        shop = await db.transaction(async (tx) => {
          const [s] = await tx
            .insert(schema.shops)
            .values({
              ownerId: user.id,
              name: data.name,
              slug,
              description: data.description ?? null,
            })
            .returning()
          await tx
            .update(schema.users)
            .set({ role: "seller" })
            .where(eq(schema.users.id, user.id))
          return s
        })
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError("TAKEN", "That shop name is taken — try another")
        }
        throw err
      }

      return { id: shop.id, slug: shop.slug }
    })
  )
