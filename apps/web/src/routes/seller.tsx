import { createFileRoute, redirect } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Placeholder seller area — full dashboard in plan-9, product CRUD in plan-7.
export const Route = createFileRoute("/seller")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: "/seller" } })
    }
    if (context.session.role === "buyer") {
      throw redirect({ to: "/seller/onboarding" })
    }
  },
  component: SellerPlaceholder,
})

function SellerPlaceholder() {
  const { session } = Route.useRouteContext()
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Seller area <Badge>{session!.role}</Badge>
          </CardTitle>
          <CardDescription>
            Product management (plan-7) and dashboard (plan-9) land here next.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </main>
  )
}
