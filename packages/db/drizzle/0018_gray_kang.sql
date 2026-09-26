CREATE TYPE "public"."ledger_kind" AS ENUM('sale', 'refund', 'adjustment', 'payout');--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'marked_paid' NOT NULL,
	"memo" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"sub_order_id" uuid,
	"order_id" uuid,
	"kind" "ledger_kind" NOT NULL,
	"gross_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ledger" ADD CONSTRAINT "seller_ledger_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ledger" ADD CONSTRAINT "seller_ledger_sub_order_id_sub_orders_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "public"."sub_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payouts_shop_idx" ON "payouts" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "seller_ledger_shop_idx" ON "seller_ledger" USING btree ("shop_id","created_at");