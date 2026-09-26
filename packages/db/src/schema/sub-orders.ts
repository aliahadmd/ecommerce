import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { orders, orderItems } from "./commerce"
import { shops } from "./shops"

export const subOrderStatus = pgEnum("sub_order_status", [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
])

export const subOrders = pgTable(
  "sub_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict" }),
    status: subOrderStatus("status").notNull().default("pending"),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("sub_orders_order_shop_unique").on(t.orderId, t.shopId),
    index("sub_orders_shop_idx").on(t.shopId, t.status, t.createdAt),
  ],
)

// order_items.sub_order_id is added via a raw SQL statement in the migration
// (orderItems table lives in commerce.ts and gains the column there).
export const subOrderHelpers = { orderItems }
