import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import {
  getCategories,
  getTags,
  listProducts,
} from "@/server/catalog"
import { getAttributeFacets } from "@/server/attributes"
import { ProductCard } from "@/components/product-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { unwrap } from "@/lib/unwrap"
import { useWishlistSet } from "@/components/wishlist-heart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** attribute facet filters arrive as a_<slug> search params (comma-joined values) */
function facetSelectionFromSearch(
  search: Record<string, unknown>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(search).flatMap(([k, v]) =>
      k.startsWith("a_") && typeof v === "string" && v.length > 0
        ? [[k.slice(2), v.split(",")]]
        : [],
    ),
  )
}

export const Route = createFileRoute("/products/")({
  validateSearch: z
    .object({
      q: z.string().optional(),
      category: z.string().optional(),
      tag: z.string().optional(),
      min: z.coerce.number().optional(),
      max: z.coerce.number().optional(),
      sort: z
        .enum(["newest", "price-asc", "price-desc", "rating-desc"])
        .optional(),
      page: z.coerce.number().optional(),
      minRating: z.coerce.number().optional(),
    })
    .catch({}),
  loaderDeps: ({ search }) => [search],
  loader: async ({ context: { queryClient }, deps: [search] }) => {
    const facets = facetSelectionFromSearch(search)
    await queryClient.ensureQueryData({
      queryKey: ["products", search],
      queryFn: () =>
        listProducts({ data: { ...search, attributes: facets } }).then(unwrap),
    })
  },
  component: ProductsPage,
})

function ProductsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const facetSelection = facetSelectionFromSearch(search)
  const { data } = useQuery({
    queryKey: ["products", search],
    queryFn: () =>
      listProducts({ data: { ...search, attributes: facetSelection } }).then(
        unwrap,
      ),
  })
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories().then(unwrap),
  })
  const { data: tags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => getTags().then(unwrap),
  })
  // facets are computed per selected category (server guard)
  const { data: facets } = useQuery({
    queryKey: ["facets", search.category],
    queryFn: () =>
      search.category
        ? getAttributeFacets({ data: { categorySlug: search.category } }).then(
            unwrap,
          )
        : Promise.resolve([]),
    enabled: !!search.category,
    staleTime: 60_000,
  })

  function patch(next: Partial<typeof search>) {
    void navigate({ to: "/products", search: { ...search, ...next } })
  }

  function toggleFacetValue(attrSlug: string, value: string) {
    const current = facetSelection[attrSlug] ?? []
    const nextValues = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    const key = `a_${attrSlug}`
    const next = { ...search }
    if (nextValues.length > 0) {
      ;(next as Record<string, unknown>)[key] = nextValues.join(",")
    } else {
      delete (next as Record<string, unknown>)[key]
    }
    void navigate({ to: "/products", search: next })
    void queryClient
  }

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1
  const items = data?.items
  const wishlist = useWishlistSet((items ?? []).map((p) => p.id))
  const wishlistCtx = {
    savedSet: wishlist.savedSet,
    queryKey: ["products", search],
  }

  const hasFacets = (facets ?? []).length > 0

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const q = String(
              new FormData(e.currentTarget).get("q") ?? "",
            ).trim()
            patch({ q: q || undefined, page: 1 })
          }}
          className="flex flex-1 gap-2"
        >
          <Input
            name="q"
            defaultValue={search.q ?? ""}
            placeholder="Search products or SKU…"
            className="max-w-xs"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        <Select
          value={search.category ?? "all"}
          onValueChange={(v) =>
            patch({ category: v && v !== "all" ? v : undefined, page: 1 })
          }
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
          onBlur={(e) =>
            patch({
              min: e.target.value ? Number(e.target.value) : undefined,
              page: 1,
            })
          }
          className="w-24"
        />
        <Input
          type="number"
          placeholder="Max $"
          defaultValue={search.max ?? ""}
          onBlur={(e) =>
            patch({
              max: e.target.value ? Number(e.target.value) : undefined,
              page: 1,
            })
          }
          className="w-24"
        />

        <Select
          value={search.sort ?? "newest"}
          onValueChange={(v) =>
            patch({
              sort: (v ?? "newest"),
              page: 1,
            })
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="rating-desc">Top rated</SelectItem>
            <SelectItem value="price-asc">Price: low → high</SelectItem>
            <SelectItem value="price-desc">Price: high → low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-6">
        {/* sidebar: rating + attribute facets */}
        <aside className="w-52 shrink-0 space-y-5 hidden lg:block">
          <div>
            <h3 className="mb-2 text-sm font-medium">Rating</h3>
            {[4, 3, 2].map((stars) => (
              <label key={stars} className="flex items-center gap-2 py-0.5 text-sm">
                <Checkbox
                  checked={search.minRating === stars}
                  onCheckedChange={(v) =>
                    patch({
                      minRating: v === true ? stars : undefined,
                      page: 1,
                    })
                  }
                />
                {stars}★ &amp; up
              </label>
            ))}
          </div>
          {hasFacets &&
            (facets ?? []).map((facet) => (
              <div key={facet.attributeId}>
                <h3 className="mb-2 text-sm font-medium">{facet.name}</h3>
                {facet.values.map((entry) => {
                  const value = String(entry.value)
                  const checked = (facetSelection[facet.slug] ?? []).includes(value)
                  return (
                    <label
                      key={value}
                      className="flex items-center gap-2 py-0.5 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleFacetValue(facet.slug, value)}
                      />
                      {value}
                      <span className="text-muted-foreground">({entry.count})</span>
                    </label>
                  )
                })}
              </div>
            ))}
        </aside>

        <div className="flex-1">
          {(search.q ||
            search.category ||
            search.tag ||
            search.min ||
            search.max ||
            search.minRating ||
            Object.keys(facetSelection).length > 0) && (
            <p className="text-muted-foreground mb-4 text-sm">
              {data?.total ?? 0} results
              <button
                className="ml-3 underline"
                onClick={() => patch({ q: undefined, category: undefined, tag: undefined, min: undefined, max: undefined, minRating: undefined, page: 1 })}
              >
                clear filters
              </button>
            </p>
          )}

          <div className="stagger-grid grid grid-cols-2 gap-4 md:grid-cols-3">
            {!items
              ? Array.from({ length: 9 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-4/3 w-full" />
                ))
              : items.map((p) => (
                  <ProductCard key={p.id} product={p} wishlist={wishlistCtx} />
                ))}
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
        </div>
      </div>
    </main>
  )
}
