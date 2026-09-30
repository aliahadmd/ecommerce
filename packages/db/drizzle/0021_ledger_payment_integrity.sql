-- plan 005 + plan 002: DB backstops for money integrity.
-- One sale/refund ledger row per sub-order (concurrent "mark delivered" can't
-- double-credit), and exactly one payment row per order.
CREATE UNIQUE INDEX "seller_ledger_sub_kind_uq" ON "seller_ledger" USING btree ("sub_order_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_uq" ON "payments" USING btree ("order_id");--> statement-breakpoint
DROP INDEX IF EXISTS "payments_order_idx";--> statement-breakpoint
-- L11: these FKs were hand-added in 0013/0016 but never declared in the
-- Drizzle schema. Declaring them now brings the snapshot in line; the DO
-- blocks keep this a no-op where they already exist.
DO $$ BEGIN
  ALTER TABLE "carts" ADD CONSTRAINT "carts_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sub_order_id_sub_orders_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "public"."sub_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
