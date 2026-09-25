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
import { adminListReviews, setReviewStatus } from "@/server/reviews"
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
      void queryClient.invalidateQueries({ queryKey: ["product"] })
    },
  })

  return (
    <div>
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
                    onClick={() => setStatus.mutate({ reviewId: r.id, status: "hidden" })}
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
