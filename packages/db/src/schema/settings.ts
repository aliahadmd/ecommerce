import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { subOrders } from "./sub-orders"
import { shops } from "./shops"

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const ledgerKind = pgEnum("ledger_kind", [
  "sale",
  "refund",
  "adjustment",
  "payout",
])

export const sellerLedger = pgTable(
  "seller_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict" }),
    subOrderId: uuid("sub_order_id").references(() => subOrders.id, {
      onDelete: "set null",
    }),
    orderId: uuid("order_id"),
    kind: ledgerKind("kind").notNull(),
    grossCents: integer("gross_cents").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    netCents: integer("net_cents").notNull(),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("seller_ledger_shop_idx").on(t.shopId, t.createdAt)]
)

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("marked_paid"),
    memo: text("memo"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("payouts_shop_idx").on(t.shopId, t.createdAt)]
)
