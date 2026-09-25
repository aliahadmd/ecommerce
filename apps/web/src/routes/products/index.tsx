import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { getCategories, getTags, listProducts } from "@/server/catalog"
import { ProductCard } from "@/components/product-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { unwrap } from "@/lib/unwrap"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export const Route = createFileRoute("/products/")({
  validateSearch: z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    tag: z.string().optional(),
    min: z.coerce.number().optional(),
    max: z.coerce.number().optional(),
    sort: z.enum(["newest", "price-asc", "price-desc"]).optional(),
    page: z.coerce.number().optional(),
  }),
  loaderDeps: ({ search }) => [search],
  loader: async ({ context: { queryClient }, deps: [search] }) => {
    await queryClient.ensureQueryData({
      queryKey: ["products", search],
      queryFn: () => listProducts({ data: search }).then(unwrap),
    })
  },
  component: ProductsPage,
})

function ProductsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ["products", search],
    queryFn: () => listProducts({ data: search }).then(unwrap),
  })
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories().then(unwrap),
  })
  const { data: tags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => getTags().then(unwrap),
  })

  function patch(next: Partial<typeof search>) {
    void navigate({
      to: "/products",
      search: { ...search, ...next },
    })
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const items = data?.items

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const q = String(new FormData(e.currentTarget).get("q") ?? "").trim()
            patch({ q: q || undefined, page: 1 })
          }}
          className="flex flex-1 gap-2"
        >
          <Input
            name="q"
            defaultValue={search.q ?? ""}
            placeholder="Search products…"
            className="max-w-xs"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        <Select
          value={search.category ?? "all"}
          onValueChange={(v) => patch({ category: v && v !== "all" ? v : undefined, page: 1 })}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(categories ?? []).map((c) => (
              <SelectItem key={c.id} value={c.slug}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={search.tag ?? "all"}
          onValueChange={(v) => patch({ tag: v && v !== "all" ? v : undefined, page: 1 })}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {(tags ?? []).map((t) => (
              <SelectItem key={t.id} value={t.slug}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="number"
          placeholder="Min $"
          defaultValue={search.min ?? ""}
          onBlur={(e) => patch({ min: e.target.value ? Number(e.target.value) : undefined, page: 1 })}
          className="w-24"
        />
        <Input
          type="number"
          placeholder="Max $"
          defaultValue={search.max ?? ""}
          onBlur={(e) => patch({ max: e.target.value ? Number(e.target.value) : undefined, page: 1 })}
          className="w-24"
        />

        <Select
          value={search.sort ?? "newest"}
          onValueChange={(v) => patch({ sort: (v ?? "newest"), page: 1 })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="price-asc">Price: low → high</SelectItem>
            <SelectItem value="price-desc">Price: high → low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(search.q || search.category || search.tag || search.min || search.max) && (
        <p className="text-muted-foreground mb-4 text-sm">
          {data?.total ?? 0} results
          <button
            className="ml-3 underline"
            onClick={() =>
              patch({ q: undefined, category: undefined, tag: undefined, min: undefined, max: undefined, page: 1 })
            }
          >
            clear filters
          </button>
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {!items
          ? Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-4/3 w-full" />
            ))
          : items.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>

      {items?.length === 0 && (
        <div className="text-muted-foreground py-16 text-center text-sm">
          No products match these filters.
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={(search.page ?? 1) <= 1}
            onClick={() => patch({ page: (search.page ?? 1) - 1 })}
          >
            Previous
          </Button>
          <span className="text-sm">
            Page {search.page ?? 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={(search.page ?? 1) >= totalPages}
            onClick={() => patch({ page: (search.page ?? 1) + 1 })}
          >
            Next
          </Button>
        </div>
      )}
    </main>
  )
}
