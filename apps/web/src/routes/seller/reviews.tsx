import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { replyToReview, listShopReviews } from "@/server/reviews"
import { unwrap } from "@/lib/unwrap"
import { StarRating } from "@/components/star-rating"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

export const Route = createFileRoute("/seller/reviews")({
  component: SellerReviewsPage,
})

function SellerReviewsPage() {
  const queryClient = useQueryClient()
  const { data: reviews } = useQuery({
    queryKey: ["shop-reviews"],
    queryFn: () => listShopReviews().then(unwrap),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["shop-reviews"] })
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Product reviews</h1>
      <div className="space-y-3">
        {(reviews ?? []).map((r) => (
          <ReviewWithReply key={r.id} review={r} onChanged={refresh} />
        ))}
        {reviews?.length === 0 && (
          <p className="text-muted-foreground py-12 text-center text-sm">
            No reviews yet — they appear here as buyers review your products.
          </p>
        )}
      </div>
    </div>
  )
}

function ReviewWithReply({
  review,
  onChanged,
}: {
  review: {
    id: string
    rating: number
    title: string
    body: string
    sellerReply: string | null
    createdAt: string | Date
    authorName: string
    productTitle: string
  }
  onChanged: () => void
}) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState(review.sellerReply ?? "")

  const saveReply = useMutation({
    mutationFn: () => replyToReview({ data: { reviewId: review.id, reply: reply.trim() } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Reply saved")
      setReplying(false)
      onChanged()
    },
  })

  return (
    <Card className="py-0">
      <CardContent className="py-4 text-sm">
        <div className="flex items-center gap-2">
          <StarRating value={review.rating} className="size-3.5" />
          <span className="font-medium">{review.title}</span>
          <Badge variant="outline">{review.productTitle}</Badge>
          <span className="text-muted-foreground ml-auto text-xs">
            {review.authorName} · {new Date(review.createdAt).toLocaleDateString()}
          </span>
        </div>
        <p className="mt-2 leading-relaxed">{review.body}</p>
        {review.sellerReply && !replying && (
          <div className="bg-muted mt-2 rounded-lg p-3">
            <p className="mb-1 text-xs font-medium">Your reply</p>
            <p className="whitespace-pre-line">{review.sellerReply}</p>
          </div>
        )}
        {!replying ? (
          <Button
            variant="outline"
            size="xs"
            className="mt-3"
            onClick={() => {
              setReply(review.sellerReply ?? "")
              setReplying(true)
            }}
          >
            {review.sellerReply ? "Edit reply" : "Reply"}
          </Button>
        ) : (
          <div className="mt-3 space-y-2">
            <Textarea
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Respond as the seller…"
            />
            <div className="flex gap-2">
              <Button size="xs" disabled={saveReply.isPending || reply.trim().length < 2} onClick={() => saveReply.mutate()}>
                Save reply
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setReplying(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
