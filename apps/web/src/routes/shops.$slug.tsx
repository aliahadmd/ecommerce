import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { getShop } from "@/server/catalog"
import { ProductCard } from "@/components/product-card"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { unwrap } from "@/lib/unwrap"

export const Route = createFileRoute("/shops/$slug")({
  loader: async ({ context: { queryClient }, params }) => {
    await queryClient.ensureQueryData({
      queryKey: ["shop", params.slug],
      queryFn: () => getShop({ data: { slug: params.slug } }).then(unwrap),
    })
  },
  component: ShopPage,
})

function ShopPage() {
  const { slug } = Route.useParams()
  const { data } = useQuery({
    queryKey: ["shop", slug],
    queryFn: () => getShop({ data: { slug } }).then(unwrap),
  })

  if (!data) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="h-24 w-full" />
      </main>
    )
  }

  const { shop, items } = data
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Card className="mb-8">
        <CardContent className="py-6">
          <h1 className="text-xl font-semibold">{shop.name}</h1>
          {shop.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {shop.description}
            </p>
          )}
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
      {items.length === 0 && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          This shop has no active products yet.
        </p>
      )}
    </main>
  )
}
