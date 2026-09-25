/**
 * The single source of truth for environment variables (plan-1 §7).
 *
 * Server-side only: importing this module in browser code will fail because
 * it reads process.env. Client code must not import it.
 *
 * All dev defaults match docker-compose.yml so a fresh clone works with
 * `make env && make up && make dev`.
 */
import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),

  // Postgres (pgvector container in dev)
  DATABASE_URL: z
    .string()
    .default("postgres://ecommerce:ecommerce@localhost:5432/ecommerce"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // SeaweedFS (S3-compatible)
  S3_ENDPOINT: z.string().default("http://localhost:8333"),
  S3_PUBLIC_URL: z.string().default("http://localhost:8333/products"),
  S3_BUCKET: z.string().default("products"),
  S3_ACCESS_KEY: z.string().default("ecommerce-dev"),
  S3_SECRET_KEY: z.string().default("ecommerce-dev-secret"),
  S3_REGION: z.string().default("us-east-1"),

  // SMTP (Mailpit in dev)
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  EMAIL_FROM: z.string().default("Ecommerce <no-reply@dev.local>"),

  // Auth
  BETTER_AUTH_SECRET: z
    .string()
    .default("dev-secret-change-me-0123456789abcdef0123456789abcdef"),
  BETTER_AUTH_URL: z.string().default("http://localhost:3000"),

  // Seed
  SUPER_ADMIN_EMAIL: z.string().default("admin@dev.local"),
  SUPER_ADMIN_PASSWORD: z.string().default("Admin1234!"),

  // AI (OpenRouter) — empty key disables AI features gracefully
  OPENROUTER_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("z-ai/glm-4.6"),
  AI_DAILY_LIMIT: z.coerce.number().default(500),

  // Commerce
  CURRENCY: z.string().length(3).default("USD"),
  SHIPPING_FEE_CENTS: z.coerce.number().default(0),
})

export type Env = z.infer<typeof envSchema>

/**
 * In production these MUST be provided explicitly (no compiled-in defaults,
 * and known dev defaults are refused). Guarding here means a misconfigured
 * production container fails fast at boot with a readable error.
 */
const PROD_REQUIRED = [
  "DATABASE_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_PUBLIC_URL",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "SMTP_HOST",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const

const PROD_FORBIDDEN_DEFAULTS: Partial<Record<(typeof PROD_REQUIRED)[number], string>> = {
  BETTER_AUTH_SECRET: "dev-secret-change-me-0123456789abcdef0123456789abcdef",
  S3_ACCESS_KEY: "ecommerce-dev",
  S3_SECRET_KEY: "ecommerce-dev-secret",
  DATABASE_URL: "postgres://ecommerce:ecommerce@localhost:5432/ecommerce",
}

function assertProductionEnv(): void {
  const missing = PROD_REQUIRED.filter((key) => !process.env[key])
  const problems: string[] = []
  if (missing.length > 0) {
    problems.push(`missing required variables:\n  - ${missing.join("\n  - ")}`)
  }
  const devDefaults = PROD_REQUIRED.filter(
    (key) =>
      process.env[key] !== undefined &&
      process.env[key] === PROD_FORBIDDEN_DEFAULTS[key],
  )
  if (devDefaults.length > 0) {
    problems.push(`dev defaults are not allowed in production:\n  - ${devDefaults.join("\n  - ")}`)
  }
  if (problems.length > 0) {
    throw new Error(`Production environment misconfigured:\n${problems.join("\n")}`)
  }
}

let cached: Env | null = null

export function getEnv(): Env {
  if (cached) return cached
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid environment configuration:\n${details}`)
  }
  if (result.data.NODE_ENV === "production") assertProductionEnv()
  cached = result.data
  return cached
}
