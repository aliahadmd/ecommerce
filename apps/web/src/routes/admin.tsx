import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router"
import { Shield } from "lucide-react"

/** Admin section layout: super_admin guard + sidebar (plan-9 polishes this). */
export const Route = createFileRoute("/admin")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: "/admin" } })
    }
    if (context.session.role !== "super_admin") {
      throw redirect({ to: "/" })
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav className="mb-6 flex gap-1 text-sm">
        <Link
          to="/admin"
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          <Shield className="mr-1.5 inline size-4" /> Dashboard
        </Link>
        <Link
          to="/admin/catalog"
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          Catalog
        </Link>
        <Link
          to="/admin/orders"
          search={{}}
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          Orders
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
