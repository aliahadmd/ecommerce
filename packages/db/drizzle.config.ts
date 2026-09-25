import "dotenv/config"
import { defineConfig } from "drizzle-kit"
import { getEnv } from "./src/env-proxy"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: getEnv().DATABASE_URL,
  },
})
