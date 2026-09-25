import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { formatMoney } from "@ecommerce/config"
import { toast } from "sonner"
import {
  adminListUsers,
  adminSetUserBanned,
  adminSetUserRole,
  getAdminStats,
} from "@/server/admin"
import { unwrap } from "@/lib/unwrap"
import type { Role } from "@/server/session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
  
} from "@/components/ui/chart"
import type {ChartConfig} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { Users, Store, Package, ShoppingCart, DollarSign, Ban } from "lucide-react"

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
})

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
        <CardTitle className="text-muted-foreground text-xs font-medium">
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

const chartConfig = {
  count: { label: "Orders" },
} satisfies ChartConfig

function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => getAdminStats().then(unwrap),
  })
  const { data: users, refetch } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminListUsers().then(unwrap),
  })
  const [banning, setBanning] = useState<{ id: string; name: string } | null>(null)
  const [reason, setReason] = useState("")

  const setRole = useMutation({
    mutationFn: (input: { userId: string; role: Role }) =>
      adminSetUserRole({ data: input }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Role updated")
      void refetch()
    },
  })
  const setBanned = useMutation({
    mutationFn: (input: { userId: string; banned: boolean; reason?: string }) =>
      adminSetUserBanned({ data: input }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("User updated")
      setBanning(null)
      setReason("")
      void refetch()
    },
  })

  const chartData = (stats?.ordersPerDay ?? []).map((d) => ({
    day: d.day.slice(5),
    orders: d.count,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={<Users className="text-muted-foreground size-4" />} label="Users" value={String(stats?.users ?? "–")} />
        <StatCard icon={<Store className="text-muted-foreground size-4" />} label="Sellers" value={String(stats?.sellers ?? "–")} />
        <StatCard icon={<Package className="text-muted-foreground size-4" />} label="Active products" value={String(stats?.products ?? "–")} />
        <StatCard icon={<ShoppingCart className="text-muted-foreground size-4" />} label="Orders (30d)" value={String(stats?.orders30d ?? "–")} />
        <StatCard icon={<DollarSign className="text-muted-foreground size-4" />} label="Revenue paid (30d)" value={stats ? formatMoney(stats.revenueCents) : "–"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Orders per day (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <BarChart data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="orders" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-muted-foreground text-xs">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={u.role}
                      onValueChange={(v) => setRole.mutate({ userId: u.id, role: v as Role })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="super_admin">super_admin</SelectItem>
                        <SelectItem value="seller">seller</SelectItem>
                        <SelectItem value="buyer">buyer</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{u.shopCount > 0 ? "yes" : "—"}</TableCell>
                  <TableCell>
                    {u.banned ? (
                      <Badge variant="destructive">banned</Badge>
                    ) : u.emailVerified ? (
                      <Badge variant="secondary">active</Badge>
                    ) : (
                      <Badge variant="outline">unverified</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.banned ? (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setBanned.mutate({ userId: u.id, banned: false })}
                      >
                        Unban
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setBanning({ id: u.id, name: u.name })}
                      >
                        <Ban className="size-3" /> Ban
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!banning} onOpenChange={(o) => !o && setBanning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban {banning?.name}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ban-reason">Reason</Label>
            <Input
              id="ban-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Policy violation, fraud suspicion…"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBanning(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() =>
                banning && setBanned.mutate({ userId: banning.id, banned: true, reason })
              }
            >
              Ban user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
