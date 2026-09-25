import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { toast } from "sonner"
import { addToCart } from "@/server/commerce"
import { getProduct } from "@/server/catalog"
import { unwrap } from "@/lib/unwrap"
import { setCartCount } from "@/lib/cart-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"

export const Route = createFileRoute("/products/$slug")({
  loader: async ({ context: { queryClient }, params }) => {
    await queryClient.ensureQueryData({
      queryKey: ["product", params.slug],
      queryFn: () => getProduct({ data: { slug: params.slug } }).then(unwrap),
    })
  },
  component: ProductDetailPage,
})

function ProductDetailPage() {
  const { slug } = Route.useParams()
  const queryClient = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: ["product", slug],
    queryFn: () => getProduct({ data: { slug } }).then(unwrap),
  })

  const add = useMutation({
    mutationFn: (quantity: number) => addToCart({ data: { productId: product.id, quantity } }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      setCartCount(r.data.count)
      void queryClient.invalidateQueries({ queryKey: ["cart"] })
      toast.success("Added to cart")
    },
    onError: (e) => toast.error((e).message),
  })

  if (isError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">Product not found</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          It may have been unpublished or the link is wrong.
        </p>
        <Button render={<Link to="/products" search={{}} />} className="mt-6" variant="outline">
          Browse products
        </Button>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 md:grid-cols-2">
        <Skeleton className="aspect-square w-full" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    )
  }

  const { product, shop, images, tags, categoryName, categorySlug } = data

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <nav className="text-muted-foreground mb-6 text-sm">
        {categorySlug && categoryName && (
          <>
            <Link to="/products" search={{ category: categorySlug }} className="hover:underline">
              {categoryName}
            </Link>
            <span className="mx-2">/</span>
          </>
        )}
        <span className="text-foreground">{product.title}</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <div className="bg-muted aspect-square w-full overflow-hidden rounded-2xl">
            {images[0] ? (
              <img src={images[0].url} alt={images[0].alt ?? product.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-6xl">🛍️</div>
            )}
          </div>
          {images.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {images.slice(1, 6).map((img) => (
                <div key={img.id} className="bg-muted aspect-square overflow-hidden rounded-lg">
                  <img src={img.url} alt={img.alt ?? product.title} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-semibold">{product.title}</h1>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-2xl font-bold">
              {formatMoney(product.priceCents, product.currency)}
            </span>
            {product.stock > 0 ? (
              <Badge variant="secondary">{product.stock} in stock</Badge>
            ) : (
              <Badge variant="destructive">Out of stock</Badge>
            )}
          </div>

          <div className="text-muted-foreground mt-3 text-sm">
            Sold by{" "}
            <Link to="/shops/$slug" params={{ slug: shop.slug }} className="text-foreground font-medium hover:underline">
              {shop.name}
            </Link>
          </div>

          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Link key={t.id} to="/products" search={{ tag: t.slug }}>
                  <Badge variant="outline">{t.name}</Badge>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center gap-2">
            <Button
              disabled={product.stock === 0 || add.isPending}
              onClick={() => add.mutate(1)}
            >
              Add to cart
            </Button>
          </div>

          <Separator className="my-6" />
          <p className="text-sm leading-relaxed whitespace-pre-line">{product.description}</p>
        </div>
      </div>
    </main>
  )
}
