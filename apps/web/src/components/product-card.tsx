import { Link } from "@tanstack/react-router"
import { formatMoney } from "@ecommerce/config"
import { Badge } from "@/components/ui/badge"
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
}

export function ProductCard({ product }: { product: ProductCardData }) {
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
        {product.stock === 0 && <Badge variant="secondary">Out of stock</Badge>}
      </CardFooter>
    </Card>
  )
}
