import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

// Placeholder — seller order management lands in plan-8.
export const Route = createFileRoute("/seller/orders")({
  validateSearch: z.object({}),
  component: () => (
    <div className="rounded-xl border p-8 text-sm text-muted-foreground">
      Order management arrives in plan-8.
    </div>
  ),
})
