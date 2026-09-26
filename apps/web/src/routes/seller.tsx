import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router"
import { Store } from "lucide-react"

/** Seller section layout: auth + role guard + sidebar (plan-9 polishes this). */
export const Route = createFileRoute("/seller")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: "/seller" } })
    }
  },
  component: SellerLayout,
})

function SellerLayout() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav className="mb-6 flex gap-1 text-sm">
        <Link
          to="/seller"
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          <Store className="mr-1.5 inline size-4" /> Dashboard
        </Link>
        <Link
          to="/seller/products"
          search={{ page: 1 }}
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          Products
        </Link>
        <Link
          to="/seller/orders"
          search={{}}
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          Orders
        </Link>
        <Link
          to="/seller/payouts"
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          Payouts
        </Link>
        <Link
          to="/seller/import"
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          Import
        </Link>
        <Link
          to="/seller/reviews"
          className="rounded-md px-3 py-1.5 hover:bg-muted"
          activeProps={{ className: "bg-muted font-medium" }}
        >
          Reviews
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
