import { Link } from "@tanstack/react-router"
import { formatMoney } from "@ecommerce/config"
import { Badge } from "@/components/ui/badge"
import { WishlistHeart } from "@/components/wishlist-heart"
import { StarRating } from "@/components/star-rating"
import { Card, CardContent, CardFooter, CardTitle } from "@/components/ui/card"

export interface ProductCardData {
  id: string
  title: string
  slug: string
  priceCents: number
  currency: string
  stock: number
  shopName: string
  shopSlug: string
  imageUrl: string | null
  brand?: string | null
  condition?: "new" | "used" | "refurbished"
  ratingAvgX100?: number
  ratingCount?: number
}

/**
 * Wishlist wiring for card grids: the container resolves `savedSet` via
 * `useWishlistSet` (one batched call per grid) and passes it + its query key.
 * Omitted → no heart renders (e.g. admin tables).
 */
export interface CardGridWishlist {
  savedSet: Set<string>
  queryKey?: unknown[]
}

export function ProductCard({
  product,
  wishlist,
}: {
  product: ProductCardData
  wishlist?: CardGridWishlist
}) {
  return (
    <Card className="gap-0 overflow-hidden pt-0">
      <Link
        to="/products/$slug"
        params={{ slug: product.slug }}
        className="block"
      >
        <div className="aspect-4/3 w-full overflow-hidden bg-muted">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.title}
              className="h-full w-full object-cover transition-transform hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-3xl text-muted-foreground">
              🛍️
            </div>
          )}
        </div>
      </Link>
      <CardContent className="p-4 pb-2">
        <CardTitle className="line-clamp-2 text-sm font-medium">
          <Link
            to="/products/$slug"
            params={{ slug: product.slug }}
            className="hover:underline"
          >
            {product.title}
          </Link>
        </CardTitle>
        {product.brand && (
          <p className="text-muted-foreground mt-0.5 text-xs">{product.brand}</p>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-2 pb-4">
        <div>
          <div className="text-sm font-semibold">
            {formatMoney(product.priceCents, product.currency)}
          </div>
          <Link
            to="/shops/$slug"
            params={{ slug: product.shopSlug }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {product.shopName}
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {product.ratingCount !== undefined && product.ratingCount > 0 && (
            <span className="mr-1 flex items-center gap-0.5">
              <StarRating value={(product.ratingAvgX100 ?? 0) / 100} className="size-3" />
              <span className="text-muted-foreground text-[10px]">({product.ratingCount})</span>
            </span>
          )}
          {wishlist && (
            <WishlistHeart
              productId={product.id}
              savedSet={wishlist.savedSet}
              queryKey={wishlist.queryKey}
            />
          )}
          {product.condition && product.condition !== "new" && (
            <Badge variant="outline" className="capitalize">
              {product.condition}
            </Badge>
          )}
          {product.stock === 0 && <Badge variant="secondary">Out of stock</Badge>}
        </div>
      </CardFooter>
    </Card>
  )
}
