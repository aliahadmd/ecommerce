CREATE TYPE "public"."payment_state" AS ENUM('pending_on_delivery', 'requires_payment', 'processing', 'succeeded', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_id" uuid,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"amount_cents" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"state" "payment_state" DEFAULT 'processing' NOT NULL,
	"refund_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
-- COD backfill: one payment row per legacy order (cash on delivery)
INSERT INTO "payments" ("id", "order_id", "method", "provider", "amount_cents", "currency", "state", "created_at", "updated_at")
SELECT gen_random_uuid(), o.id, 'cod', 'fake', o.total_cents, o.currency,
  CASE WHEN o.payment_status = 'paid' THEN 'succeeded'::payment_state ELSE 'pending_on_delivery'::payment_state END,
  o.created_at, o.updated_at
FROM "orders" o
WHERE NOT EXISTS (SELECT 1 FROM "payments" p WHERE p.order_id = o.id);
