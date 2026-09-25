import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { z } from "zod"
import { formatMoney } from "@ecommerce/config"
import { toast } from "sonner"
import { listSellerProducts, archiveProduct } from "@/server/catalog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { unwrap } from "@/lib/unwrap"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/seller/products/")({
  validateSearch: z.object({ page: z.coerce.number().optional(), q: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (context.session?.role === "buyer") {
      throw redirect({ to: "/seller/onboarding" })
    }
  },
  component: SellerProductsPage,
})

type Row = {
  id: string
  title: string
  slug: string
  priceCents: number
  currency: string
  stock: number
  status: string
  imageUrl: string | null
}

const col = createColumnHelper<Row>()

function SellerProductsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isError, error } = useQuery({
    queryKey: ["seller-products", search],
    queryFn: () => listSellerProducts({ data: { page: search.page ?? 1, q: search.q } }).then(unwrap),
  })
  if (isError) {
    return <p className="text-destructive py-8">{error.message}</p>
  }

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: "active" | "archived" }) =>
      archiveProduct({ data: input }),
    onSuccess: (result, vars) => {
      if (result.ok) {
        toast.success(`Product ${vars.status === "active" ? "activated" : "archived"}`)
        void queryClient.invalidateQueries({ queryKey: ["seller-products"] })
      } else toast.error(result.error.message)
    },
  })

  const rows = data?.rows ?? []
  const columns = [
    col.display({
      id: "image",
      header: "",
      cell: ({ row }) =>
        row.original.imageUrl ? (
          <img src={row.original.imageUrl} alt="" className="size-10 rounded-md object-cover" />
        ) : (
          <div className="bg-muted flex size-10 items-center justify-center rounded-md text-xs">🛍️</div>
        ),
    }),
    col.accessor("title", {
      header: "Product",
      cell: ({ row }) => (
        <Link
          to="/products/$slug"
          params={{ slug: row.original.slug }}
          className="hover:underline"
        >
          {row.original.title}
        </Link>
      ),
    }),
    col.accessor("priceCents", {
      header: "Price",
      cell: ({ getValue, row }) => formatMoney(getValue(), row.original.currency),
    }),
    col.accessor("stock", { header: "Stock" }),
    col.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => (
        <Badge variant={getValue() === "active" ? "default" : "secondary"}>{getValue()}</Badge>
      ),
    }),
    col.display({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="outline" size="xs" render={
            <Link to="/seller/products/$id/edit" params={{ id: row.original.id }} search={{}} />
          }>
            Edit
          </Button>
          {row.original.status === "active" ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setStatus.mutate({ id: row.original.id, status: "archived" })}
            >
              Archive
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setStatus.mutate({ id: row.original.id, status: "active" })}
            >
              Activate
            </Button>
          )}
        </div>
      ),
    }),
  ]

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / data.pageSize) : 1,
  })

  const page = search.page ?? 1
  const total = data?.total ?? 0

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="flex-1 text-lg font-semibold">Your products ({total})</h1>
        <Input
          placeholder="Search…"
          defaultValue={search.q ?? ""}
          className="max-w-48"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void navigate({
                to: "/seller/products",
                search: { q: (e.target as HTMLInputElement).value || undefined, page: 1 },
              })
            }
          }}
        />
        <Button render={<Link to="/seller/products/new" search={{}} />}>New product</Button>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-12 text-center">
                  No products yet — create your first one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => navigate({ to: "/seller/products", search: { ...search, page: page - 1 } })}
        >
          Previous
        </Button>
        <span className="text-muted-foreground text-sm">Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page * 10 >= total}
          onClick={() => navigate({ to: "/seller/products", search: { ...search, page: page + 1 } })}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
