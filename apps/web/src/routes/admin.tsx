import { createFileRoute, redirect } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Placeholder admin area — dashboard + user management in plan-9.
export const Route = createFileRoute("/admin")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: "/admin" } })
    }
    if (context.session.role !== "super_admin") {
      throw redirect({ to: "/" })
    }
  },
  component: AdminPlaceholder,
})

function AdminPlaceholder() {
  const { session } = Route.useRouteContext()
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Admin area <Badge>{session!.role}</Badge>
          </CardTitle>
          <CardDescription>
            Users, moderation, orders and dashboards land here in plan-9.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </main>
  )
}
