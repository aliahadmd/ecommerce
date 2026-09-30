import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, desc, eq, isNull, sql } from "@ecommerce/db"
import { guard, requireUser } from "./session"
import { toPage } from "@/lib/pagination"

export const listNotifications = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { unreadOnly?: unknown; page?: unknown }
    return {
      unreadOnly: Boolean(raw.unreadOnly),
      page: toPage(raw.page),
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const PAGE = 20
      const conditions = [eq(schema.notifications.userId, user.id)]
      if (data.unreadOnly) {
        conditions.push(isNull(schema.notifications.readAt))
      }
      const rows = await db
        .select()
        .from(schema.notifications)
        .where(and(...conditions))
        .orderBy(desc(schema.notifications.createdAt))
        .limit(PAGE)
        .offset((data.page - 1) * PAGE)
      const [{ unread }] = await db
        .select({ unread: sql<number>`count(*) FILTER (WHERE read_at IS NULL)::int` })
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, user.id))
      return { rows, unread, page: data.page, pageSize: PAGE }
    }),
  )

export const unreadCount = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireUser()
    const [{ unread }] = await db
      .select({ unread: sql<number>`count(*) FILTER (WHERE read_at IS NULL)::int` })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, user.id))
    return { unread }
  })
)

export const markNotificationsRead = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { ids?: unknown; all?: unknown }
    const ids = Array.isArray(raw.ids) ? raw.ids.map(String) : []
    return { ids, all: Boolean(raw.all) || ids.length === 0 }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      if (data.all) {
        await db
          .update(schema.notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(schema.notifications.userId, user.id),
              isNull(schema.notifications.readAt)
            )
          )
      } else {
        for (const id of data.ids) {
          await db
            .update(schema.notifications)
            .set({ readAt: new Date() })
            .where(
              and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id))
            )
        }
      }
      return { ok: true }
    }),
  )
