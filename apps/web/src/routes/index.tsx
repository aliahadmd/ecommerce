import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { getCategories, listProducts, listProductsBySlugs } from "@/server/catalog"
import { ProductCard } from "@/components/product-card"
import { useWishlistSet } from "@/components/wishlist-heart"
import { useRecentlyViewed } from "@/lib/recently-viewed"
import { Skeleton } from "@/components/ui/skeleton"
import { unwrap } from "@/lib/unwrap"

export const Route = createFileRoute("/")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["products", {}],
      queryFn: () => listProducts().then(unwrap),
    })
    await queryClient.ensureQueryData({
      queryKey: ["categories"],
      queryFn: () => getCategories().then(unwrap),
    })
  },
  component: HomePage,
})

function HomePage() {
  const { data: products } = useQuery({
    queryKey: ["products", {}],
    queryFn: () => listProducts().then(unwrap),
  })
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories().then(unwrap),
  })

  const wishlist = useWishlistSet((products?.items ?? []).map((p) => p.id))
  const wishlistCtx = { savedSet: wishlist.savedSet, queryKey: ["products", {}] }
  const recentSlugs = useRecentlyViewed()
  const { data: recentProducts } = useQuery({
    queryKey: ["recently-viewed", recentSlugs],
    queryFn: () => listProductsBySlugs({ data: { slugs: recentSlugs } }).then(unwrap),
    enabled: recentSlugs.length > 0,
  })

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <section className="mb-10 rounded-2xl bg-muted px-8 py-14 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Everything you need, from sellers you can trust
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          A community marketplace. Browse, order, and pay cash on delivery.
        </p>
      </section>

      <h2 className="mb-4 text-lg font-semibold">Shop by category</h2>
      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(categories ?? []).map((c) => (
          <Link
            key={c.id}
            to="/products"
            search={{ category: c.slug }}
            className="rounded-xl bg-muted px-4 py-6 text-center text-sm font-medium transition-colors hover:bg-secondary"
          >
            {c.name}
          </Link>
        ))}
      </div>

      {recentProducts && recentProducts.length > 0 && (
        <>
          <h2 className="mb-4 text-lg font-semibold">Recently viewed</h2>
          <div className="stagger-grid mb-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {recentProducts.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}

      <h2 className="mb-4 text-lg font-semibold">New arrivals</h2>
      <div className="stagger-grid grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {!products
          ? Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-4/3 w-full" />
            ))
          : products.items
              .slice(0, 8)
              .map((p) => <ProductCard key={p.id} product={p} wishlist={wishlistCtx} />)}
      </div>
    </main>
  )
}
