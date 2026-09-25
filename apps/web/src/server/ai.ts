import { createServerFn } from "@tanstack/react-start"
import { db, schema } from "@ecommerce/db"
import { rateLimit } from "@ecommerce/redis"
import { getEnv } from "@ecommerce/config"
import {
  generateProductDescription,
  isAiEnabled,
  suggestTagsForProduct,
} from "@ecommerce/ai"
import { AppError, guard, requireRole } from "./session"

export const aiStatus = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("seller", "super_admin")
    return { enabled: isAiEnabled(), model: getEnv().AI_MODEL }
  }),
)

export const generateDescription = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { title?: unknown; categoryName?: unknown; tagNames?: unknown }
    const title = String(raw.title ?? "").trim()
    if (title.length < 3) throw new AppError("INVALID", "Enter a title first")
    return {
      title: title.slice(0, 200),
      categoryName: raw.categoryName ? String(raw.categoryName).slice(0, 80) : null,
      tagNames: Array.isArray(raw.tagNames) ? (raw.tagNames as unknown[]).map(String).slice(0, 10) : [],
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      if (!isAiEnabled()) {
        throw new AppError("AI_DISABLED", "AI features are not configured (missing OPENROUTER_API_KEY)")
      }
      const allowed = await rateLimit("ai-desc", user.id, 10, 3600)
      if (!allowed) throw new AppError("RATE_LIMITED", "AI limit reached — try again later")
      const daily = await rateLimit("ai-daily", "global", getEnv().AI_DAILY_LIMIT, 86400)
      if (!daily) throw new AppError("RATE_LIMITED", "AI daily budget reached")
      const description = await generateProductDescription(data)
      return { description }
    }),
  )

export const suggestTags = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { title?: unknown; description?: unknown }
    const title = String(raw.title ?? "").trim()
    const description = String(raw.description ?? "").trim()
    if (title.length < 3) throw new AppError("INVALID", "Enter a title first")
    return { title: title.slice(0, 200), description: description.slice(0, 1000) }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      if (!isAiEnabled()) {
        throw new AppError("AI_DISABLED", "AI features are not configured (missing OPENROUTER_API_KEY)")
      }
      const allowed = await rateLimit("ai-tags", user.id, 20, 3600)
      if (!allowed) throw new AppError("RATE_LIMITED", "AI limit reached — try again later")
      const existing = await db.select({ name: schema.tags.name }).from(schema.tags)
      const suggestions = await suggestTagsForProduct({
        title: data.title,
        description: data.description,
        existingTagNames: existing.map((t) => t.name),
      })
      return { suggestions }
    }),
  )
