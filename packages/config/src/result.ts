/**
 * Serializable error envelope for server functions. Server functions never
 * throw to the client — they return this shape so forms can render errors.
 */
export type Result<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}
