import { sql } from "drizzle-orm";
import {
  check,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { productTypes } from "./attributes"
import { shops } from "./shops";

export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);

export const productCondition = pgEnum("product_condition", [
  "new",
  "used",
  "refurbished",
]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
    onDelete: "set null",
  }),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull(),
    summary: text("summary"),
    brand: text("brand"),
    condition: productCondition("condition").notNull().default("new"),
    weightGrams: integer("weight_grams"),
    dimensions: jsonb("dimensions")
      .$type<{ l: number; w: number; h: number } | null>(), // { l, w, h } in mm
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
    /** average rating ×100 (0..500) — maintained by review writes */
    ratingAvgX100: integer("rating_avg_x100").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    /** Integer minor units (cents) — never floats. */
    priceCents: integer("price_cents").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    stock: integer("stock").notNull().default(0),
    status: productStatus("status").notNull().default("draft"),
    productTypeId: uuid("product_type_id").references(() => productTypes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("products_status_category_idx").on(t.status, t.categoryId),
    index("products_shop_idx").on(t.shopId),
    index("products_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    check("products_price_cents_check", sql`${t.priceCents} >= 0`),
    check("products_stock_check", sql`${t.stock} >= 0`),
    check("products_weight_grams_check", sql`${t.weightGrams} >= 0`),
    check("products_low_stock_threshold_check", sql`${t.lowStockThreshold} >= 0`),
    check("products_rating_avg_check", sql`${t.ratingAvgX100} BETWEEN 0 AND 500`),
    check("products_rating_count_check", sql`${t.ratingCount} >= 0`),
    index("products_rating_idx").on(t.status, t.ratingAvgX100, t.ratingCount),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** S3 object key, e.g. shops/{shopId}/products/{productId}/{uuid}.jpg */
    key: text("key").notNull().unique(),
    url: text("url").notNull(),
    alt: text("alt"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("product_images_product_idx").on(t.productId, t.sortOrder)],
);

export const productTags = pgTable(
  "product_tags",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.tagId] })],
);
