CREATE TYPE "public"."attribute_kind" AS ENUM('text', 'number', 'boolean', 'select', 'multiselect');--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_type_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "attribute_kind" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit" text,
	"required" boolean DEFAULT false NOT NULL,
	"use_for_variants" boolean DEFAULT false NOT NULL,
	"filterable" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_attribute_values" (
	"product_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "product_attribute_values_product_id_attribute_id_pk" PRIMARY KEY("product_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE "product_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_type_id" uuid;--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attribute_id_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_definitions_type_slug_unique" ON "attribute_definitions" USING btree ("product_type_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_definitions_global_slug_idx" ON "attribute_definitions" USING btree ("slug") WHERE "attribute_definitions"."product_type_id" IS NULL;--> statement-breakpoint
CREATE INDEX "product_attribute_values_attr_idx" ON "product_attribute_values" USING btree ("attribute_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE set null ON UPDATE no action;