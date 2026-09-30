import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { StarRating } from "@/components/star-rating"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { adminListReviews, deleteReview, setReviewStatus } from "@/server/reviews"
import { dismissReviewReport, listReportedReviews } from "@/server/settings"
import { unwrap } from "@/lib/unwrap"
import { toast } from "sonner"

export const Route = createFileRoute("/admin/reviews")({
  component: AdminReviewsPage,
})

function AdminReviewsPage() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["admin-reviews"],
    queryFn: () => adminListReviews({ data: {} }).then(unwrap),
  })

  const setStatus = useMutation({
    mutationFn: (input: { reviewId: string; status: "approved" | "hidden" }) =>
      setReviewStatus({ data: input }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Review updated")
      void queryClient.invalidateQueries({ queryKey: ["admin-reviews"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-reported-reviews"] })
      void queryClient.invalidateQueries({ queryKey: ["product"] })
    },
  })
  const { data: reported } = useQuery({
    queryKey: ["admin-reported-reviews"],
    queryFn: () => listReportedReviews().then(unwrap),
  })
  const dismiss = useMutation({
    mutationFn: (reviewId: string) => dismissReviewReport({ data: { reviewId } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Report dismissed")
      void queryClient.invalidateQueries({ queryKey: ["admin-reported-reviews"] })
    },
  })
  // "Delete" used to only hide the review; it now really deletes
  const remove = useMutation({
    mutationFn: (reviewId: string) => deleteReview({ data: { reviewId } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Review deleted")
      void queryClient.invalidateQueries({ queryKey: ["admin-reviews"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-reported-reviews"] })
      void queryClient.invalidateQueries({ queryKey: ["product"] })
    },
  })

  return (
    <div>
      {reported && reported.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold">
            Reported reviews ({reported.length})
          </h2>
          <div className="space-y-2">
            {reported.map((r) => (
              <div key={r.reviewId} className="rounded-xl border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <StarRating value={r.rating} className="size-3" />
                  <span className="font-medium">{r.title}</span>
                  <Badge variant="destructive">{r.reports} report(s)</Badge>
                  <div className="ml-auto flex gap-1.5">
                    <Button variant="outline" size="xs" onClick={() => dismiss.mutate(r.reviewId)}>
                      Dismiss
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setStatus.mutate({ reviewId: r.reviewId, status: "hidden" })
                        dismiss.mutate(r.reviewId)
                      }}
                    >
                      Hide
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2">{r.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      <h1 className="mb-4 text-lg font-semibold">
        Review moderation {data ? `(${data.total})` : ""}
      </h1>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.rows ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-40 truncate">{r.productTitle}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <StarRating value={r.rating} className="size-3" />
                    <span className="truncate font-medium">{r.title}</span>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {r.authorName} · {new Date(r.createdAt).toLocaleDateString()} · {r.helpfulCount} helpful
                  </span>
                </TableCell>
                <TableCell>{r.authorName}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "approved" ? "secondary" : "destructive"}>
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {r.status === "approved" ? (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setStatus.mutate({ reviewId: r.id, status: "hidden" })}
                    >
                      Hide
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setStatus.mutate({ reviewId: r.id, status: "approved" })}
                    >
                      Unhide
                    </Button>
                  )}{" "}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      if (window.confirm("Delete this review permanently?")) remove.mutate(r.id)
                    }}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {data?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-12 text-center">
                  No reviews yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
