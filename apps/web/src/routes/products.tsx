import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

// Placeholder — replaced by the storefront catalog in plan-7.
export const Route = createFileRoute("/products")({
  validateSearch: z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    tag: z.string().optional(),
    min: z.coerce.number().optional(),
    max: z.coerce.number().optional(),
    sort: z.enum(["newest", "price-asc", "price-desc"]).optional(),
    page: z.coerce.number().optional(),
  }),
  component: () => <main className="p-8">Storefront catalog — coming right up (plan-7)</main>,
})
