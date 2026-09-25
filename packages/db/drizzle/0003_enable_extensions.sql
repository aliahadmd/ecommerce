-- Extensions are created here (not only by docker/init) so migrations work
-- against any fresh external database (plan-11 fix).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
