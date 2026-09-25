import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import {
  createAttribute,
  createProductType,
  deleteAttribute,
  deleteProductType,
  listProductTypes,
  reorderAttributes,
  updateAttribute,
  updateProductType,
} from "@/server/attributes"
import { unwrap } from "@/lib/unwrap"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export const Route = createFileRoute("/admin/types")({
  component: AdminTypesPage,
})

type Kind = "text" | "number" | "boolean" | "select" | "multiselect"

interface AttributeDraft {
  id?: string
  name: string
  kind: Kind
  options: string[]
  unit: string
  required: boolean
  useForVariants: boolean
  filterable: boolean
  productTypeId: string | null
}

const emptyDraft: AttributeDraft = {
  name: "",
  kind: "text",
  options: [],
  unit: "",
  required: false,
  useForVariants: false,
  filterable: false,
  productTypeId: null,
}

function AdminTypesPage() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["product-types"],
    queryFn: () => listProductTypes().then(unwrap),
  })
  const types = data?.types ?? []
  const definitions = data?.definitions ?? []

  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const selectedType = types.find((t) => t.id === selectedTypeId) ?? null
  const typeDefinitions = definitions.filter(
    (d) => d.productTypeId === (selectedTypeId ?? null) || d.productTypeId === null,
  )

  const [typeDialog, setTypeDialog] = useState<{ id?: string; name: string } | null>(null)
  const [attrDialog, setAttrDialog] = useState<AttributeDraft | null>(null)

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["product-types"] })
  }

  const saveType = useMutation({
    mutationFn: () => {
      if (!typeDialog) throw new Error("No dialog")
      return typeDialog.id
        ? updateProductType({ data: { id: typeDialog.id, name: typeDialog.name } })
        : createProductType({ data: { name: typeDialog.name } })
    },
    onSuccess: (r) => {
      if (r && !r.ok) toast.error(r.error.message)
      else toast.success("Type saved")
      setTypeDialog(null)
      refresh()
    },
  })

  const removeType = useMutation({
    mutationFn: (id: string) => deleteProductType({ data: { id } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Type deleted")
      setSelectedTypeId(null)
      refresh()
    },
  })

  const saveAttr = useMutation({
    mutationFn: () => {
      if (!attrDialog) throw new Error("No dialog")
      const payload = {
        name: attrDialog.name,
        kind: attrDialog.kind,
        options: attrDialog.options,
        unit: attrDialog.unit || undefined,
        required: attrDialog.required,
        useForVariants: attrDialog.useForVariants,
        filterable: attrDialog.filterable,
        productTypeId: selectedTypeId,
      }
      return attrDialog.id
        ? updateAttribute({ data: { id: attrDialog.id, ...payload } })
        : createAttribute({ data: payload })
    },
    onSuccess: (r) => {
      if (r && !r.ok) toast.error(r.error.message)
      else toast.success("Attribute saved")
      setAttrDialog(null)
      refresh()
    },
  })

  const removeAttr = useMutation({
    mutationFn: (id: string) => deleteAttribute({ data: { id } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Attribute deleted")
      refresh()
    },
  })

  const moveAttr = useMutation({
    mutationFn: (ids: string[]) => reorderAttributes({ data: { ids } }),
    onSuccess: refresh,
  })

  function move(id: string, dir: -1 | 1) {
    const ids = typeDefinitions.map((d) => d.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i === -1 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    moveAttr.mutate(ids)
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Product types & attributes</h1>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Types</h2>
            <Button size="xs" variant="outline" onClick={() => setTypeDialog({ name: "" })}>
              + New
            </Button>
          </div>
          <div className="space-y-1">
            <button
              className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${
                selectedTypeId === null ? "bg-muted font-medium" : ""
              }`}
              onClick={() => setSelectedTypeId(null)}
            >
              Global attributes
            </button>
            {types.map((t) => (
              <div key={t.id} className="flex items-center gap-1">
                <button
                  className={`min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${
                    selectedTypeId === t.id ? "bg-muted font-medium" : ""
                  }`}
                  onClick={() => setSelectedTypeId(t.id)}
                >
                  <span className="block truncate">{t.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {t.productCount} product(s)
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Edit ${t.name}`}
                  onClick={() => setTypeDialog({ id: t.id, name: t.name })}
                >
                  ✎
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => removeType.mutate(t.id)}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {selectedType ? `${selectedType.name} attributes` : "Global attributes"}{" "}
              <span className="text-muted-foreground">(also shown: global)</span>
            </h2>
            <Button
              size="xs"
              onClick={() => setAttrDialog({ ...emptyDraft, productTypeId: selectedTypeId })}
            >
              + New attribute
            </Button>
          </div>
          <div className="space-y-2">
            {typeDefinitions.map((d) => (
              <div key={d.id} className="rounded-xl border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {d.kind}
                    {d.unit ? ` (${d.unit})` : ""}
                  </span>
                  {d.required && <span className="text-xs text-destructive">required</span>}
                  {d.useForVariants && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                      variant axis
                    </span>
                  )}
                  {d.filterable && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">facet</span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="icon-xs" aria-label="Move up" onClick={() => move(d.id, -1)}>
                      ↑
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Move down" onClick={() => move(d.id, 1)}>
                      ↓
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        setAttrDialog({
                          id: d.id,
                          name: d.name,
                          kind: d.kind,
                          options: d.options,
                          unit: d.unit ?? "",
                          required: d.required,
                          useForVariants: d.useForVariants,
                          filterable: d.filterable,
                          productTypeId: d.productTypeId,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => removeAttr.mutate(d.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
                {(d.kind === "select" || d.kind === "multiselect") && d.options.length > 0 && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Options: {d.options.join(" · ")}
                  </p>
                )}
              </div>
            ))}
            {typeDefinitions.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No attributes yet.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* type dialog */}
      <Dialog open={!!typeDialog} onOpenChange={(o) => !o && setTypeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{typeDialog?.id ? "Edit type" : "New product type"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="type-name">Name</Label>
            <Input
              id="type-name"
              value={typeDialog?.name ?? ""}
              onChange={(e) => setTypeDialog((d) => (d ? { ...d, name: e.target.value } : d))}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTypeDialog(null)}>
              Cancel
            </Button>
            <Button disabled={saveType.isPending || !typeDialog?.name} onClick={() => saveType.mutate()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* attribute dialog */}
      <Dialog open={!!attrDialog} onOpenChange={(o) => !o && setAttrDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{attrDialog?.id ? "Edit attribute" : "New attribute"}</DialogTitle>
          </DialogHeader>
          {attrDialog && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="attr-name">Name</Label>
                <Input
                  id="attr-name"
                  value={attrDialog.name}
                  onChange={(e) => setAttrDialog({ ...attrDialog, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Kind</Label>
                <Select
                  value={attrDialog.kind}
                  onValueChange={(v) => setAttrDialog({ ...attrDialog, kind: v as Kind })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="boolean">Boolean</SelectItem>
                    <SelectItem value="select">Select</SelectItem>
                    <SelectItem value="multiselect">Multi-select</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(attrDialog.kind === "select" || attrDialog.kind === "multiselect") && (
                <div className="space-y-1.5">
                  <Label htmlFor="attr-options">Options (comma-separated)</Label>
                  <Input
                    id="attr-options"
                    value={attrDialog.options.join(", ")}
                    onChange={(e) =>
                      setAttrDialog({
                        ...attrDialog,
                        options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean),
                      })
                    }
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="attr-unit">Unit (optional)</Label>
                <Input
                  id="attr-unit"
                  value={attrDialog.unit}
                  onChange={(e) => setAttrDialog({ ...attrDialog, unit: e.target.value })}
                />
              </div>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={attrDialog.required}
                    onCheckedChange={(v) => setAttrDialog({ ...attrDialog, required: v === true })}
                  />
                  Required (must be filled before publishing)
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={attrDialog.useForVariants}
                    onCheckedChange={(v) => setAttrDialog({ ...attrDialog, useForVariants: v === true })}
                  />
                  Use for variants (select only)
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={attrDialog.filterable}
                    onCheckedChange={(v) => setAttrDialog({ ...attrDialog, filterable: v === true })}
                  />
                  Filterable (storefront facet)
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAttrDialog(null)}>
              Cancel
            </Button>
            <Button disabled={saveAttr.isPending || !attrDialog?.name} onClick={() => saveAttr.mutate()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
