-- rate_limits.lastRequest must hold epoch milliseconds (better-auth writes a
-- number, not a Date); the table is transient so drop-and-recreate is safe.
DROP TABLE "rate_limits";
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
