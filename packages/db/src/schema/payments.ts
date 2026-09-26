import { index, integer, pgEnum, pgTable, text, timestamp, uuid, char } from "drizzle-orm/pg-core"
import { orders, paymentMethod } from "./commerce"


export const paymentState = pgEnum("payment_state", [
  "pending_on_delivery",
  "requires_payment",
  "processing",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
])

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull(),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref").unique(),
    amountCents: integer("amount_cents").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    state: paymentState("state").notNull().default("processing"),
    refundCents: integer("refund_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("payments_order_idx").on(t.orderId)],
)

export const paymentEvents = pgTable("payment_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull().unique(),
  paymentId: uuid("payment_id").references(() => payments.id, {
    onDelete: "set null",
  }),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
