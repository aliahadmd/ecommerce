import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

// Placeholder — user management lands in plan-9.
export const Route = createFileRoute("/admin/users")({
  validateSearch: z.object({}),
  component: () => (
    <div className="rounded-xl border p-8 text-sm text-muted-foreground">
      User management arrives in plan-9.
    </div>
  ),
})
