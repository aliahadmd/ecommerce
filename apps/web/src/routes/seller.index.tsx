import { createFileRoute } from "@tanstack/react-router"

import { useQuery } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { getSellerStats } from "@/server/admin"
import { unwrap } from "@/lib/unwrap"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { Package, Clock, HandCoins, DollarSign } from "lucide-react"

export const Route = createFileRoute("/seller/")({
  component: SellerDashboard,
})

const chartConfig = {
  count: { label: "Orders" },
} satisfies ChartConfig

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {label}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  )
}

function SellerDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["seller-stats"],
    queryFn: () => getSellerStats().then(unwrap),
  })

  const chartData = (stats?.ordersPerDay ?? []).map((d) => ({
    day: d.day.slice(5),
    orders: d.count,
  }))

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">
        {stats?.shopName ?? "Your shop"}
      </h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Package className="size-4 text-muted-foreground" />}
          label="Active products"
          value={String(stats?.activeProducts ?? "–")}
        />
        <StatCard
          icon={<Clock className="size-4 text-muted-foreground" />}
          label="Orders to act on"
          value={String(stats?.pendingOrders ?? "–")}
        />
        <StatCard
          icon={<HandCoins className="size-4 text-muted-foreground" />}
          label="Delivered, awaiting cash"
          value={String(stats?.unpaidDelivered ?? "–")}
        />
        <StatCard
          icon={<DollarSign className="size-4 text-muted-foreground" />}
          label="Revenue paid (30d)"
          value={stats ? formatMoney(stats.revenueCents) : "–"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Orders per day (last 30 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-48 w-full">
            <BarChart data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="orders" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Recent orders</CardTitle>
          <Button
            render={<a href="/seller/orders" />}
            variant="outline"
            size="xs"
          >
            View all
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(stats?.recentOrders ?? []).map((o) => (
            <div key={o.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1 font-medium">{o.orderNumber}</span>
              <Badge
                variant={o.status === "cancelled" ? "destructive" : "secondary"}
              >
                {o.status}
              </Badge>
              <Badge
                variant={o.paymentStatus === "paid" ? "default" : "outline"}
              >
                {o.paymentStatus}
              </Badge>
              <span className="w-20 text-right font-semibold">
                {formatMoney(o.totalCents, o.currency)}
              </span>
            </div>
          ))}
          {stats?.recentOrders.length === 0 && (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
