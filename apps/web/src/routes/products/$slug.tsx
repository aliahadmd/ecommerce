import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Fragment, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { toast } from "sonner"
import { addToCart } from "@/server/commerce"
import { getProduct, listRelatedProducts } from "@/server/catalog"
import { ProductCard } from "@/components/product-card"
import { useWishlistSet, WishlistHeart } from "@/components/wishlist-heart"
import { unwrap } from "@/lib/unwrap"
import { setCartCount } from "@/lib/cart-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"

export const Route = createFileRoute("/products/$slug")({
  loader: async ({ context: { queryClient }, params }) => {
    const data = await queryClient.ensureQueryData({
      queryKey: ["product", params.slug],
      queryFn: () => getProduct({ data: { slug: params.slug } }).then(unwrap),
    })
    return {
      title: data.product.seoTitle ?? data.product.title,
      description:
        data.product.seoDescription ??
        data.product.summary ??
        data.product.description.slice(0, 160),
    }
  },
  head: ({ match }) => ({
    meta: [
      { title: `${match.loaderData?.title ?? "Product"} — Ecommerce` },
      { name: "description", content: match.loaderData?.description ?? "" },
    ],
  }),
  component: ProductDetailPage,
})

function ProductDetailPage() {
  const { slug } = Route.useParams()
  const queryClient = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: ["product", slug],
    queryFn: () => getProduct({ data: { slug } }).then(unwrap),
  })

  const navigate = useNavigate()
  const [quantity, setQuantity] = useState(1)
  const add = useMutation({
    mutationFn: (qty: number) =>
      addToCart({ data: { productId: product.id, quantity: qty } }),
    onSuccess: (r) => {
      if (!r.ok) {
        // Send unauthenticated visitors to login instead of a dead-end toast
        if (r.error.code === "UNAUTHORIZED") {
          void navigate({
            to: "/login",
            search: { redirect: `/products/${product.slug}` },
          })
          return
        }
        toast.error(r.error.message)
        return
      }
      setCartCount(r.data.count)
      void queryClient.invalidateQueries({ queryKey: ["cart"] })
      toast.success("Added to cart")
    },
    onError: (e) => toast.error(e.message),
  })

  if (isError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">Product not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been unpublished or the link is wrong.
        </p>
        <Button
          render={<Link to="/products" search={{}} />}
          className="mt-6"
          variant="outline"
        >
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

  const { product, shop, images, tags, attributes, categoryName, categorySlug } = data

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        {categorySlug && categoryName && (
          <>
            <Link
              to="/products"
              search={{ category: categorySlug }}
              className="hover:underline"
            >
              {categoryName}
            </Link>
            <span className="mx-2">/</span>
          </>
        )}
        <span className="text-foreground">{product.title}</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <div className="aspect-square w-full overflow-hidden rounded-2xl bg-muted">
            {images[0] ? (
              <img
                src={images[0].url}
                alt={images[0].alt ?? product.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-6xl">
                🛍️
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {images.slice(1, 6).map((img) => (
                <div
                  key={img.id}
                  className="aspect-square overflow-hidden rounded-lg bg-muted"
                >
                  <img
                    src={img.url}
                    alt={img.alt ?? product.title}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-semibold">{product.title}</h1>
          {product.summary && (
            <p className="text-muted-foreground mt-1 text-sm">{product.summary}</p>
          )}
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

          <div className="mt-3 text-sm text-muted-foreground">
            Sold by{" "}
            <Link
              to="/shops/$slug"
              params={{ slug: shop.slug }}
              className="font-medium text-foreground hover:underline"
            >
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
            <WishlistHeart productId={product.id} savedSet={new Set()} />
            <div className="flex items-center">
              <Button
                variant="outline"
                size="icon"
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </Button>
              <span className="w-10 text-center text-sm font-medium">
                {quantity}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Increase quantity"
                disabled={product.stock === 0 || quantity >= product.stock}
                onClick={() =>
                  setQuantity((q) => Math.min(product.stock, q + 1))
                }
              >
                +
              </Button>
            </div>
            <Button
              disabled={product.stock === 0 || add.isPending}
              onClick={() => add.mutate(quantity)}
            >
              Add to cart
            </Button>
          </div>

          {attributes.length > 0 && (
            <>
              <Separator className="my-6" />
              <h2 className="mb-2 text-sm font-semibold">Specifications</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {attributes
                  .filter((a) => !a.useForVariants)
                  .map((a) => (
                    <Fragment key={a.slug}>
                      <dt className="text-muted-foreground">{a.name}</dt>
                      <dd>
                        {Array.isArray(a.value) ? a.value.join(", ") : String(a.value)}
                        {a.unit ? ` ${a.unit}` : ""}
                      </dd>
                    </Fragment>
                  ))}
              </dl>
            </>
          )}
          <Separator className="my-6" />
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {product.description}
          </p>
        </div>
      </div>

      <RelatedProducts slug={slug} />
    </main>
  )
}

function RelatedProducts({ slug }: { slug: string }) {
  const { data: related } = useQuery({
    queryKey: ["related", slug],
    queryFn: () => listRelatedProducts({ data: { slug } }).then(unwrap),
    staleTime: 60_000,
  })
  const wishlist = useWishlistSet((related ?? []).map((p) => p.id))
  const wishlistCtx = { savedSet: wishlist.savedSet, queryKey: ["related", slug] }
  if (!related || related.length === 0) return null
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-lg font-semibold">Related products</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {related.map((p) => (
          <ProductCard key={p.id} product={p} wishlist={wishlistCtx} />
        ))}
      </div>
    </section>
  )
}
