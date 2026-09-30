import { Button } from "@/components/ui/button"

/** Prev/next for server-paged lists (a full page implies there may be more). */
export function Pager({
  page,
  onPage,
  count,
  pageSize,
}: {
  page: number
  onPage: (page: number) => void
  count: number
  pageSize: number
}) {
  if (page === 1 && count < pageSize) return null
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-muted-foreground">Page {page}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={count < pageSize}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  )
}
