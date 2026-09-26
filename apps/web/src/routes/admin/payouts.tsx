import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { formatMoney } from "@ecommerce/config"
import { toast } from "sonner"
import {
  createPayout,
  getPayoutOverview,
  listPayouts,
} from "@/server/payouts"
import { unwrap } from "@/lib/unwrap"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/admin/payouts")({
  component: AdminPayoutsPage,
})

function AdminPayoutsPage() {
  const queryClient = useQueryClient()
  const { data: overview } = useQuery({
    queryKey: ["payout-overview"],
    queryFn: () => getPayoutOverview().then(unwrap),
  })
  const { data: history } = useQuery({
    queryKey: ["admin-payout-history"],
    queryFn: () => listPayouts().then(unwrap),
  })
  const [pendingShop, setPendingShop] = useState<string | null>(null)

  const payout = useMutation({
    mutationFn: (input: { shopId: string; amountCents: number }) =>
      createPayout({ data: { ...input, memo: "Admin payout" } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Payout marked")
      void queryClient.invalidateQueries({ queryKey: ["payout-overview"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-payout-history"] })
      setPendingShop(null)
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Shop payouts</h1>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shop</TableHead>
              <TableHead>Earned</TableHead>
              <TableHead>Refunded</TableHead>
              <TableHead>Paid out</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(overview ?? []).map((s) => (
              <TableRow key={s.shopId}>
                <TableCell className="font-medium">{s.shopName}</TableCell>
                <TableCell>{formatMoney(s.earned)}</TableCell>
                <TableCell>{formatMoney(s.refunded)}</TableCell>
                <TableCell>{formatMoney(s.paidOut)}</TableCell>
                <TableCell className="text-right font-semibold">
                  {formatMoney(s.available)}
                </TableCell>
                <TableCell className="text-right">
                  {s.available > 0 && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={pendingShop === s.shopId}
                      onClick={() => {
                        setPendingShop(s.shopId)
                        payout.mutate({ shopId: s.shopId, amountCents: s.available })
                      }}
                    >
                      Mark paid {formatMoney(s.available)}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {overview?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  No shops yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {(history ?? []).length > 0 && (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>{p.shopName}</TableCell>
                  <TableCell className="text-right">
                    {formatMoney(p.amountCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
