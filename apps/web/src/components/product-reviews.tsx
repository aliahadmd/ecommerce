import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { StarRating } from "@/components/star-rating"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { canReview, createReview, listReviews, voteReview } from "@/server/reviews"
import { unwrap } from "@/lib/unwrap"
import { ThumbsUp } from "lucide-react"

export function ProductReviews({ productId }: { productId: string }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<"newest" | "helpful">("newest")

  const { data: summary } = useQuery({
    queryKey: ["review-summary", productId],
    queryFn: () => listReviews({ data: { productId, page: 1, sort } }).then(unwrap),
  })
  const { data } = useQuery({
    queryKey: ["reviews", productId, page, sort],
    queryFn: () => listReviews({ data: { productId, page, sort } }).then(unwrap),
  })
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["reviews", productId] })
    void queryClient.invalidateQueries({ queryKey: ["review-summary", productId] })
    void queryClient.invalidateQueries({ queryKey: ["product", productId] })
    void queryClient.invalidateQueries({ queryKey: ["products"] })
    void queryClient.invalidateQueries({ queryKey: ["can-review", productId] })
  }

  return (
    <section className="mt-12">
      <h2 className="mb-4 text-lg font-semibold">Reviews</h2>

      {/* summary */}
      <div className="mb-6 flex items-center gap-6">
        <div className="text-center">
          <div className="text-3xl font-bold">
            {((summary?.rows.length ?? 0) > 0 && summary
              ? (
                  (summary.rows.reduce((s, r) => s + r.rating, 0) || 0) /
                  Math.max(1, summary.rows.length)
                ).toFixed(1)
              : "–")}
          </div>
          <StarRating
            value={
              summary && summary.rows.length > 0
                ? summary.rows.reduce((s, r) => s + r.rating, 0) / summary.rows.length
                : 0
            }
          />
          <div className="text-muted-foreground text-xs">{summary?.total ?? 0} reviews</div>
        </div>
        <div className="flex-1">
          <EligibilityAndForm productId={productId} onChanged={refresh} />
        </div>
      </div>

      <Separator className="mb-4" />

      {/* sort */}
      <div className="mb-3 flex gap-2 text-sm">
        {(["newest", "helpful"] as const).map((s) => (
          <button
            key={s}
            className={`rounded-md px-2.5 py-1 ${sort === s ? "bg-muted font-medium" : "hover:bg-muted"}`}
            onClick={() => {
              setSort(s)
              setPage(1)
            }}
          >
            {s === "newest" ? "Newest" : "Most helpful"}
          </button>
        ))}
      </div>

      {/* list */}
      <div className="space-y-4">
        {(data?.rows ?? []).map((r) => (
          <ReviewRow key={r.id} review={r} onChanged={refresh} />
        ))}
        {data?.rows.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No reviews yet.
          </p>
        )}
      </div>

      {data && data.total > data.pageSize && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {page} of {Math.ceil(data.total / data.pageSize)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  )
}

function EligibilityAndForm({
  productId,
  onChanged,
}: {
  productId: string
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(5)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")

  const { data: eligibility } = useQuery({
    queryKey: ["can-review", productId],
    queryFn: () => canReview({ data: { productId } }).then(unwrap),
  })

  const submit = useMutation({
    mutationFn: () =>
      createReview({
        data: { productId, rating, title: title.trim(), body: body.trim() },
      }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else {
        toast.success("Thanks for your review!")
        setOpen(false)
        setTitle("")
        setBody("")
        setRating(5)
        onChanged()
      }
    },
  })

  if (!eligibility) return null
  if (!eligibility.eligible) {
    return <p className="text-muted-foreground text-sm">{eligibility.reason}</p>
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Write a review
      </Button>
    )
  }

  return (
    <form
      className="w-full max-w-lg space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate()
      }}
    >
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setRating(n)}
            className="text-2xl leading-none"
          >
            <span className={n <= rating ? "text-amber-400" : "text-muted-foreground/40"}>★</span>
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-title">Title</Label>
        <Input
          id="review-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={3}
          maxLength={120}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-body">Your review</Label>
        <Textarea
          id="review-body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={10}
          maxLength={2000}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? "Posting…" : "Post review"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

interface ReviewRowData {
  id: string
  rating: number
  title: string
  body: string
  helpfulCount: number
  sellerReply: string | null
  createdAt: string | Date
  authorName: string
  verifiedPurchase: boolean
  edited: boolean
  myVote: boolean
}

function ReviewRow({ review, onChanged }: { review: ReviewRowData; onChanged: () => void }) {
  const vote = useMutation({
    mutationFn: () => voteReview({ data: { reviewId: review.id } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      onChanged()
    },
  })

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center gap-2 text-sm">
        <StarRating value={review.rating} className="size-3.5" />
        <span className="font-medium">{review.title}</span>
        <span className="text-muted-foreground text-xs">
          {review.authorName.slice(0, 1).toUpperCase()}
          {review.authorName.split(" ").slice(-1)[0]?.slice(0, 1).toUpperCase() ?? ""}.
        </span>
        {review.verifiedPurchase && <Badge variant="secondary">Verified purchase</Badge>}
        {review.edited && (
          <span className="text-muted-foreground text-[10px]">(edited)</span>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          {new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
            -Math.max(1, Math.round((Date.now() - new Date(review.createdAt).getTime()) / 86400000)),
            "day",
          )}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{review.body}</p>
      {review.sellerReply && (
        <div className="bg-muted mt-3 rounded-lg p-3 text-sm">
          <p className="mb-1 text-xs font-medium">Seller response</p>
          <p className="whitespace-pre-line">{review.sellerReply}</p>
        </div>
      )}
      <div className="mt-3">
        <Button
          variant={review.myVote ? "secondary" : "ghost"}
          size="xs"
          onClick={() => vote.mutate()}
        >
          <ThumbsUp className="size-3" /> Helpful ({review.helpfulCount})
        </Button>
      </div>
    </div>
  )
}
