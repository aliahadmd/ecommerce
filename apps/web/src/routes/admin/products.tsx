import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { formatMoney } from "@ecommerce/config"
import { toast } from "sonner"
import { adminListProducts, archiveProduct } from "@/server/catalog"
import { unwrap } from "@/lib/unwrap"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/admin/products")({
  validateSearch: z.object({
    status: z.enum(["draft", "active", "archived"]).optional(),
    page: z.coerce.number().optional(),
  }),
  loaderDeps: ({ search }) => [search],
  loader: async ({ context: { queryClient }, deps: [search] }) => {
    await queryClient.ensureQueryData({
      queryKey: ["admin-products", search],
      queryFn: () =>
        adminListProducts({
          data: {
            status: search.status,
            page: search.page,
          },
        }).then(unwrap),
    })
  },
  component: AdminProductsPage,
})

const statusVariant = (s: string) =>
  s === "active" ? "default" : s === "archived" ? "destructive" : "secondary"

function AdminProductsPage() {
  const search = Route.useSearch()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["admin-products", search],
    queryFn: () =>
      adminListProducts({
        data: {
          status: search.status,
          page: search.page,
        },
      }).then(unwrap),
  })

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: "active" | "archived" }) =>
      archiveProduct({ data: input }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Product updated")
      void queryClient.invalidateQueries({ queryKey: ["admin-products"] })
    },
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const page = search.page ?? 1
  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="flex-1 text-lg font-semibold">
          All products ({total})
        </h1>
        {(["active", "draft", "archived"] as const).map((s) => (
          <Button
            key={s}
            size="xs"
            variant={search.status === s ? "default" : "outline"}
            onClick={() => {
              window.location.search = search.status === s ? "" : `?status=${s}`
            }}
          >
            {s}
          </Button>
        ))}
      </div>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-56 truncate font-medium">
                  {r.title}
                </TableCell>
                <TableCell>{r.shopName}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {formatMoney(r.priceCents, r.currency)}
                </TableCell>
                <TableCell className="text-right">
                  {r.status === "active" ? (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        setStatus.mutate({ id: r.id, status: "archived" })
                      }
                    >
                      Archive
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        setStatus.mutate({ id: r.id, status: "active" })
                      }
                    >
                      Activate
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-12 text-center"
                >
                  No products{search.status ? ` with status "${search.status}"` : ""}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              window.location.search = `?${new URLSearchParams({
                ...(search.status ? { status: search.status } : {}),
                page: String(page - 1),
              }).toString()}`
            }}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              window.location.search = `?${new URLSearchParams({
                ...(search.status ? { status: search.status } : {}),
                page: String(page + 1),
              }).toString()}`
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
