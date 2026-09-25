import type { Result } from "@ecommerce/config"

/** Unwrap a server-function Result into data for TanStack Query. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
