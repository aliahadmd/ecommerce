import { defineConfig } from "vitest/config"

// unit tests live in src only — e2e/*.spec.ts belongs to Playwright
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
})
