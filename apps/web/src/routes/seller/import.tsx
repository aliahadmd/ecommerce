import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { commitImport, stageImport } from "@/server/import"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"

export const Route = createFileRoute("/seller/import")({
  component: ImportPage,
})

interface StageResult {
  importId: string
  total: number
  valid: number
  errorCount: number
  errors: { row: number; reason: string }[]
}

function ImportPage() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [staged, setStaged] = useState<StageResult | null>(null)

  const stage = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append("file", file)
      return stageImport({ data: fd })
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      setStaged(r.data)
    },
    onError: (e) => toast.error(e.message),
  })

  const commit = useMutation({
    mutationFn: () => commitImport({ data: { importId: staged!.importId } }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      toast.success(
        `${r.data.created} products${r.data.variants ? ` and ${r.data.variants} variants` : ""} imported as drafts`,
      )
      setStaged(null)
      void queryClient.invalidateQueries({ queryKey: ["seller-products"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-products"] })
    },
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Import products from CSV</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">1. Upload CSV</CardTitle>
          <CardDescription>
            Columns: row_kind, title, slug, brand, condition, price_cents,
            stock, status, variant_title, variant_sku, description, category.
            Max 1000 rows, 2MB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="csv-file" className="sr-only">
            CSV file
          </Label>
          <input
            id="csv-file"
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) stage.mutate(f)
              e.target.value = ""
            }}
          />
          {stage.isPending && (
            <p className="text-muted-foreground mt-2 text-sm">Parsing…</p>
          )}
        </CardContent>
      </Card>

      {staged && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Dry run: {staged.valid} valid, {staged.errorCount} invalid of{" "}
              {staged.total} rows
            </CardTitle>
            <CardDescription>
              Commit creates products as drafts in your shop, all or nothing.
              Slugs that already exist get a suffix (nothing is overwritten).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {staged.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/40 p-3 text-sm">
                <p className="text-destructive mb-1 font-medium">Errors</p>
                <ul className="text-muted-foreground list-inside list-disc text-xs">
                  {staged.errors.map((e) => (
                    <li key={e.row}>
                      Row {e.row}: {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              onClick={() => commit.mutate()}
              disabled={commit.isPending || staged.valid === 0}
            >
              {commit.isPending ? "Importing…" : `Import ${staged.valid} rows`}
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
