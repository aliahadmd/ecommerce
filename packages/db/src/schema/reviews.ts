import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { products } from "./catalog"
import { users } from "./auth"
import { orderItems } from "./commerce"

export const reviewStatus = pgEnum("review_status", ["approved", "hidden"])

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** verified-purchase proof */
    orderItemId: uuid("order_item_id").references(() => orderItems.id, {
      onDelete: "set null",
    }),
    rating: integer("rating").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: reviewStatus("status").notNull().default("approved"),
    sellerReply: text("seller_reply"),
    sellerRepliedAt: timestamp("seller_replied_at", { withTimezone: true }),
    helpfulCount: integer("helpful_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("reviews_product_user_unique").on(t.productId, t.userId),
    index("reviews_product_status_idx").on(t.productId, t.status, t.createdAt),
    check("reviews_rating_check", sql`${t.rating} BETWEEN 1 AND 5`),
    check("reviews_title_check", sql`char_length(${t.title}) BETWEEN 3 AND 120`),
    check("reviews_body_check", sql`char_length(${t.body}) BETWEEN 10 AND 2000`),
  ],
)

export const reviewVotes = pgTable(
  "review_votes",
  {
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.userId] })],
)
