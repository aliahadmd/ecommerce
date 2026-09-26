import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { formatMoney } from "@ecommerce/config"
import { toast } from "sonner"
import {
  adminListCoupons,
  createCoupon,
  deleteCoupon,
} from "@/server/coupons"
import { unwrap } from "@/lib/unwrap"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/admin/coupons")({
  component: AdminCouponsPage,
})

interface CouponDraft {
  code: string
  kind: "percent" | "fixed" | "free_shipping"
  value: string
  minSubtotal: string
  maxUses: string
  maxUsesPerUser: string
  expiresAt: string
}

const emptyDraft: CouponDraft = {
  code: "",
  kind: "percent",
  value: "10",
  minSubtotal: "0",
  maxUses: "",
  maxUsesPerUser: "1",
  expiresAt: "",
}

function AdminCouponsPage() {
  const queryClient = useQueryClient()
  const { data: coupons } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: () => adminListCoupons().then(unwrap),
  })
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<CouponDraft>(emptyDraft)

  const create = useMutation({
    mutationFn: () => {
      if (!draft.code) throw new Error("no code")
      return createCoupon({
        data: {
          code: draft.code,
          kind: draft.kind,
          value: Number(draft.value),
          minSubtotalCents: Math.round(Number(draft.minSubtotal || "0") * 100),
          maxUses: draft.maxUses ? Number(draft.maxUses) : null,
          maxUsesPerUser: Number(draft.maxUsesPerUser || "1"),
          expiresAt: draft.expiresAt || null,
        },
      })
    },
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else {
        toast.success("Coupon created")
        setCreating(false)
        setDraft(emptyDraft)
        void queryClient.invalidateQueries({ queryKey: ["admin-coupons"] })
      }
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteCoupon({ data: { id } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Coupon deleted")
      void queryClient.invalidateQueries({ queryKey: ["admin-coupons"] })
    },
  })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Coupons</h1>
        <Button onClick={() => setCreating(true)}>New coupon</Button>
      </div>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Min subtotal</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(coupons ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.code}</TableCell>
                <TableCell>
                  {c.kind === "percent"
                    ? `${c.value}%`
                    : c.kind === "fixed"
                      ? formatMoney(c.value)
                      : "Free shipping"}
                </TableCell>
                <TableCell>
                  {c.minSubtotalCents
                    ? formatMoney(c.minSubtotalCents)
                    : "—"}
                </TableCell>
                <TableCell>
                  {c.uses}
                  {c.maxUses ? ` / ${c.maxUses}` : ""}
                </TableCell>
                <TableCell>
                  {c.expiresAt
                    ? new Date(c.expiresAt).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="xs" onClick={() => remove.mutate(c.id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {coupons?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  No coupons yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New coupon</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-code">Code</Label>
              <Input
                id="c-code"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                placeholder="SUMMER10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Kind</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(v) => setDraft({ ...draft, kind: v as CouponDraft["kind"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent</SelectItem>
                    <SelectItem value="fixed">Fixed (cents)</SelectItem>
                    <SelectItem value="free_shipping">Free shipping</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.kind !== "free_shipping" && (
                <div className="space-y-1.5">
                  <Label htmlFor="c-value">
                    {draft.kind === "percent" ? "Percent" : "Value (cents)"}
                  </Label>
                  <Input
                    id="c-value"
                    value={draft.value}
                    onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="c-min">Min subtotal ($)</Label>
                <Input
                  id="c-min"
                  value={draft.minSubtotal}
                  onChange={(e) => setDraft({ ...draft, minSubtotal: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-max">Max total uses</Label>
                <Input
                  id="c-max"
                  value={draft.maxUses}
                  onChange={(e) => setDraft({ ...draft, maxUses: e.target.value })}
                  placeholder="∞"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-per">Max per user</Label>
                <Input
                  id="c-per"
                  value={draft.maxUsesPerUser}
                  onChange={(e) => setDraft({ ...draft, maxUsesPerUser: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-exp">Expires (optional)</Label>
                <Input
                  id="c-exp"
                  type="date"
                  value={draft.expiresAt}
                  onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={create.isPending || !draft.code} onClick={() => create.mutate()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
