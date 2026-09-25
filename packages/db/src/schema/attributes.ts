import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { products } from "./catalog"

export const attributeKind = pgEnum("attribute_kind", [
  "text",
  "number",
  "boolean",
  "select",
  "multiselect",
])

export const productTypes = pgTable("product_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const attributeDefinitions = pgTable(
  "attribute_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = global attribute (applies to every product) */
    productTypeId: uuid("product_type_id").references(() => productTypes.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: attributeKind("kind").notNull(),
    /** select/multiselect choices: ["Red","Blue"] */
    options: jsonb("options").$type<string[]>().notNull().default([]),
    unit: text("unit"),
    required: boolean("required").notNull().default(false),
    /** plan-5: drives option selectors & variant generation */
    useForVariants: boolean("use_for_variants").notNull().default(false),
    /** plan-8: storefront facet */
    filterable: boolean("filterable").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("attribute_definitions_type_slug_unique").on(
      t.productTypeId,
      t.slug,
    ),
    uniqueIndex("attribute_definitions_global_slug_idx")
      .on(t.slug)
      .where(sql`${t.productTypeId} IS NULL`),
  ],
)

/** JSON-serializable attribute value (matches the per-kind zod validators). */
export type AttributeValue = string | number | boolean | string[]

export const productAttributeValues = pgTable(
  "product_attribute_values",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributeDefinitions.id, { onDelete: "cascade" }),
    value: jsonb("value").$type<AttributeValue>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.attributeId] }),
    index("product_attribute_values_attr_idx").on(t.attributeId),
  ],
)
