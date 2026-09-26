import { createFileRoute, redirect  } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { getSellerBalance, getSellerStatement } from "@/server/payouts"
import { unwrap } from "@/lib/unwrap"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

export const Route = createFileRoute("/seller/payouts")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      void redirect({ to: "/login", search: { redirect: "/seller/payouts" } })
      throw redirect({ to: "/login", search: { redirect: "/seller/payouts" } })
    }
  },
  component: SellerPayoutsPage,
})

function SellerPayoutsPage() {
  const { data: balance } = useQuery({
    queryKey: ["seller-balance"],
    queryFn: () => getSellerBalance().then(unwrap),
  })
  const { data: statement } = useQuery({
    queryKey: ["seller-statement"],
    queryFn: () => getSellerStatement().then(unwrap),
  })

  const kindLabel = (k: string) =>
    k === "sale" ? "Sale" : k === "refund" ? "Refund" : k === "payout" ? "Payout" : k

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Payouts</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium">
              Available balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {balance ? formatMoney(balance.available) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium">
              Lifetime earned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {balance ? formatMoney(balance.lifetimeEarned) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium">
              Paid out
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {balance ? formatMoney(balance.paidOut) : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Gross</TableHead>
              <TableHead>Commission</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(statement?.entries ?? []).map((e) => (
              <TableRow key={e.id}>
                <TableCell>{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge variant={e.kind === "refund" ? "destructive" : e.kind === "payout" ? "outline" : "secondary"}>
                    {kindLabel(e.kind)}
                  </Badge>
                </TableCell>
                <TableCell>{formatMoney(e.grossCents)}</TableCell>
                <TableCell>-{formatMoney(e.commissionCents)}</TableCell>
                <TableCell
                  className={e.netCents < 0 ? "text-right text-destructive" : "text-right"}
                >
                  {formatMoney(e.netCents)}
                </TableCell>
              </TableRow>
            ))}
            {statement?.entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  No ledger entries yet — entries appear when orders are delivered.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {(statement?.payouts ?? []).length > 0 && (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payout date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Memo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(statement?.payouts ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>{formatMoney(p.amountCents)}</TableCell>
                  <TableCell>{p.memo ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
