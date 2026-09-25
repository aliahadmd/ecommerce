import { createFileRoute } from "@tanstack/react-router"

// Placeholder — replaced by buyer order history in plan-8.
export const Route = createFileRoute("/account/orders")({
  component: () => <main className="p-8">My orders — coming right up (plan-8)</main>,
})
