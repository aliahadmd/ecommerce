CREATE TYPE "public"."sub_order_status" AS ENUM('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "sub_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" "sub_order_status" DEFAULT 'pending' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_orders_order_shop_unique" UNIQUE("order_id","shop_id")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "sub_order_id" uuid;--> statement-breakpoint
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sub_orders_shop_idx" ON "sub_orders" USING btree ("shop_id","status","created_at");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sub_order_id_sub_orders_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "public"."sub_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: one sub-order per distinct shop in each legacy order's items
INSERT INTO "sub_orders" ("id", "order_id", "shop_id", "status", "subtotal_cents", "shipping_cents", "discount_cents", "total_cents", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  o.id,
  oi.shop_id,
  o.status::text::sub_order_status,
  COALESCE(SUM(oi.total_cents), 0),
  CASE WHEN ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY oi.shop_id) = 1 THEN o.shipping_fee_cents ELSE 0 END,
  0,
  COALESCE(SUM(oi.total_cents), 0) + CASE WHEN ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY oi.shop_id) = 1 THEN o.shipping_fee_cents ELSE 0 END,
  o.created_at,
  o.updated_at
FROM "orders" o
JOIN "order_items" oi ON oi.order_id = o.id
GROUP BY o.id, oi.shop_id, o.shipping_fee_cents, o.status, o.created_at, o.updated_at;--> statement-breakpoint
-- Stamp items with their shop's sub-order
UPDATE "order_items" oi
SET "sub_order_id" = s.id
FROM "sub_orders" s
WHERE s.order_id = oi.order_id AND s.shop_id = oi.shop_id;
