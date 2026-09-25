export { db, type Tx } from "./client"
export * as schema from "./schema/index"

// Re-export the query-builder surface app code needs, so consumers depend on
// @ecommerce/db only (single drizzle version, no direct dependency).
export {
  eq,
  and,
  or,
  not,
  desc,
  asc,
  sql,
  count,
  sum,
  inArray,
  like,
  ilike,
  gte,
  lte,
  gt,
  lt,
  isNull,
  isNotNull,
} from "drizzle-orm"
