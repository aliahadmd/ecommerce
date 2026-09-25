# Plan 4 — Product Types & Attributes

**Status:** Done
**Depends on:** — (independent; plan-5 builds on it)
**Estimated effort:** 1.5–2 days

---

## Goal

Introduce **product types** (Apparel, Electronics, …) and **typed attribute definitions**, so products carry structured specs ("Capacity: 750 ml", "Material: Steel") and — in plan-5 — variant axes. Admin manages the taxonomy; sellers attach values to products.

## Schema (migration: additive)

```sql
CREATE TYPE attribute_kind AS ENUM ('text','number','boolean','select','multiselect');

CREATE TABLE product_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type_id uuid REFERENCES product_types(id) ON DELETE CASCADE,  -- null = global attribute
  name text NOT NULL,
  slug text NOT NULL,
  kind attribute_kind NOT NULL,
  options jsonb NOT NULL DEFAULT '[]',      -- ["Red","Blue"] for select/multiselect
  unit text,                                -- "ml", "g", "in"
  required boolean NOT NULL DEFAULT false,
  use_for_variants boolean NOT NULL DEFAULT false,   -- variant axis (plan-5)
  filterable boolean NOT NULL DEFAULT false,          -- storefront facet (plan-8)
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attribute_definitions_name_type_unique UNIQUE (product_type_id, slug)
);
-- slug uniqueness for GLOBAL attributes (product_type_id null):
CREATE UNIQUE INDEX attribute_definitions_global_slug_idx
  ON attribute_definitions (slug) WHERE product_type_id IS NULL;

CREATE TABLE product_attribute_values (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id uuid NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  PRIMARY KEY (product_id, attribute_id)
);
CREATE INDEX product_attribute_values_attr_idx
  ON product_attribute_values (attribute_id, value);

ALTER TABLE products ADD COLUMN product_type_id uuid REFERENCES product_types(id) ON DELETE SET NULL;
```

**Value encoding (`value jsonb`)** per kind: `text` → string; `number` → number; `boolean` → bool; `select` → string (must ∈ options); `multiselect` → string[]. Zod validates against the definition at write time — one validator per kind, options-checked for select kinds.

## Server functions (`server/attributes.ts`)

Admin (`requireRole("super_admin")`): `createProductType`, `updateProductType`, `deleteProductType` (blocked if products reference it — suggest reassign), `createAttribute`, `updateAttribute`, `deleteAttribute` (cascades values; confirm in UI), `reorderAttributes({ typeIds })` (position rewrite).

Sellers: `getProductAttributes({ productId })` — merged view: global attributes + the product's type attributes, with current values; `setProductAttributes({ productId, values: { attributeId, value }[] })` — validates each against its definition (kind + options + required), ownership-checked, one transaction (delete-missing + upsert).

Public: `getAttributeFacets({ categorySlug })` — for plan-8 (attribute + distinct values over active products in the category, only `filterable` ones); built now, consumed later.

## Invariants & rules

- An attribute with `use_for_variants = true` must be `kind = 'select'` (variant axes need discrete options) — enforced in `createAttribute`/`updateAttribute`.
- Changing an attribute's `kind`/`options` warns about existing values (UI: "N products use this") — update keeps values; invalid ones surface as validation failures on next product save.
- Deleting a product type sets `products.product_type_id = null` and cascades its attribute definitions (values cascade) — documented, confirm-dialog'd.

## UI

- **Admin** `/admin/types`: two-pane — types list (+ create/edit dialog) and, per selected type, its attribute definitions table (name, kind, options editor as tag input, unit, required, variant-axis toggle, filterable toggle, position up/down, delete).
- **Seller product form**: new "Type & specifications" section — type select (per-shop-seller choice), then dynamic spec inputs rendered from the merged definitions (text input / number input / switch / single-select / multi-select chips); required marks; values submitted with the product save via `setProductAttributes`.
- **Product page**: spec sheet table (attribute → formatted value with unit) under the description, before related products. Attributes with `use_for_variants` are excluded from the spec sheet (they render as variant selectors in plan-5).

## Acceptance criteria

- [ ] Admin creates "Apparel" type with attributes Size (select, variant-axis), Color (select, variant-axis), Material (text, filterable); attributes appear for sellers choosing that type.
- [ ] Global attribute (e.g. "Warranty months", number) shows for products of every type.
- [ ] Seller saves spec values; product page renders the spec sheet with units; invalid values (wrong kind/option) are rejected server-side with clear errors.
- [ ] Required attributes are enforced on publish (draft may save incomplete).
- [ ] Deleting a type with products is blocked; deleting an attribute cascades its values.
- [ ] `use_for_variants` only allowed for select-kind attributes (server-enforced).
- [ ] Gates green; schema has the documented constraints/indexes.

## Explicitly not in this plan

Variant generation/selection (plan-5), storefront facets (plan-8), attribute-based comparison tables.

---

## As-built note (2026-09-26)

As planned; `use_for_variants` restricted to select kind server-side; parent validation ancestor-walk; global-attribute partial unique index.
