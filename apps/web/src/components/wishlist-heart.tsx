import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { toggleWishlist, wishlistStatus } from "@/server/wishlist"
import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

/**
 * Batched saved-status lookup for grids: one server call per grid via
 * `useWishlistSet`. Use the hook in the grid container and pass the set down.
 */
export function useWishlistSet(productIds: string[]) {
  const queryClient = useQueryClient()
  const key = ["wishlist-status", [...productIds].sort().join(",")]
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => wishlistStatus({ data: { productIds } }).then((r) => (r.ok ? r.data.savedIds : [])),
    enabled: productIds.length > 0,
    staleTime: 30_000,
  })
  return { savedSet: new Set(data ?? []), queryClient, key }
}

export function WishlistHeart({
  productId,
  savedSet,
  queryKey,
}: {
  productId: string
  savedSet: Set<string>
  queryKey?: unknown[]
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const saved = optimistic ?? savedSet.has(productId)

  const toggle = useMutation({
    mutationFn: () => toggleWishlist({ data: { productId } }),
    onSuccess: (r) => {
      if (!r.ok) {
        setOptimistic(null)
        if (r.error.code === "UNAUTHORIZED") {
          void navigate({ to: "/login", search: { redirect: window.location.pathname } })
          return
        }
        toast.error(r.error.message)
        return
      }
      setOptimistic(r.data.saved)
      if (queryKey) void queryClient.invalidateQueries({ queryKey })
    },
    onError: (e) => {
      setOptimistic(null)
      toast.error((e as Error).message)
    },
  })

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      className="size-7"
      disabled={toggle.isPending}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOptimistic(!saved)
        toggle.mutate()
      }}
    >
      <Heart className={cn("size-4", saved && "fill-destructive text-destructive")} />
    </Button>
  )
}
