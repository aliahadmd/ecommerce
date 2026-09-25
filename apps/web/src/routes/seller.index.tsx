import { createFileRoute } from "@tanstack/react-router"

// Seller dashboard placeholder — stats & charts land in plan-9.
export const Route = createFileRoute("/seller/")({
  component: () => (
    <div className="rounded-xl border p-8 text-sm text-muted-foreground">
      Seller dashboard with stats and charts arrives in plan-9.
    </div>
  ),
})
