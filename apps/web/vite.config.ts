import path from "node:path"
import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import dotenv from "dotenv"

// Root .env is the single source of truth (plan-1 §7); load it into
// process.env for SSR + server functions.
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") })

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
