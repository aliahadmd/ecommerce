import { createFileRoute } from "@tanstack/react-router"

// Admin dashboard placeholder — stats & charts land in plan-9.
export const Route = createFileRoute("/admin/")({
  component: () => (
    <div className="rounded-xl border p-8 text-sm text-muted-foreground">
      Admin dashboard with stats and charts arrives in plan-9.
    </div>
  ),
})
