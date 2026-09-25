import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { getEnv } from "@ecommerce/config"
import * as schema from "./schema/index"

/** Shared drizzle client. Drizzle transactions map onto postgres-js sessions. */
export const db = drizzle(postgres(getEnv().DATABASE_URL, { max: 10 }), {
  schema,
})

/** Transaction handle type for helper functions that join a transaction. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
