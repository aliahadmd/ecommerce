import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { centsToDecimalString, formatMoney, parsePriceToCents } from "@ecommerce/config"
import { toast } from "sonner"
import {
  deleteVariant,
  generateVariants,
  listVariants,
  setDefaultVariant,
  upsertVariant,
} from "@/server/variants"
import { unwrap } from "@/lib/unwrap"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Star } from "lucide-react"

interface VariantRow {
  id: string
  sku: string
  title: string
  priceCents: number
  stock: number
  status: string
  isDefault: boolean
  options: { attributeId: string; value: string }[]
}

/** Seller-side variant manager (plan-5): generate, edit, default, delete. */
export function SellerVariants({
  productId,
  hasProductType,
  onCountChange,
}: {
  productId: string
  hasProductType: boolean
  onCountChange?: (count: number) => void
}) {
  const queryClient = useQueryClient()
  const { data: variants } = useQuery({
    queryKey: ["variants", productId],
    queryFn: () => listVariants({ data: { productId } }).then(unwrap),
  })
  useEffect(() => {
    if (variants) onCountChange?.(variants.length)
  }, [variants, onCountChange])

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["variants", productId] })
    void queryClient.invalidateQueries({ queryKey: ["seller-products"] })
    void queryClient.invalidateQueries({ queryKey: ["product-edit", productId] })
    void queryClient.invalidateQueries({ queryKey: ["product"] })
  }

  const generate = useMutation({
    mutationFn: () => generateVariants({ data: { productId } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success(`${r.data.created} variant(s) generated (draft)`)
      refresh()
    },
  })

  const setDefault = useMutation({
    mutationFn: (variantId: string) => setDefaultVariant({ data: { productId, variantId } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      refresh()
    },
  })

  const remove = useMutation({
    mutationFn: (variantId: string) => deleteVariant({ data: { variantId } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success(r.data.archived ? "Variant archived (has orders)" : "Variant deleted")
      refresh()
    },
  })

  function handleRemove(variantId: string) {
    remove.mutate(variantId)
  }

  // add dialog state
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    title: "",
    sku: "",
    price: "",
    stock: "0",
  })
  const create = useMutation({
    mutationFn: () =>
      upsertVariant({
        data: {
          productId,
          title: form.title,
          sku: form.sku,
          priceCents: parsePriceToCents(form.price) ?? 0,
          stock: Number(form.stock || "0"),
          options: [],
        },
      }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else {
        toast.success("Variant added")
        setAdding(false)
        setForm({ title: "", sku: "", price: "", stock: "0" })
        refresh()
      }
    },
  })

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-medium">
          Variants {variants ? `(${variants.length})` : ""}
        </h2>
        <Button size="xs" variant="outline" disabled={!hasProductType || generate.isPending} onClick={() => generate.mutate()}>
          Generate combinations
        </Button>
        <Button size="xs" onClick={() => setAdding(true)}>
          + Add variant
        </Button>
      </div>
      {!hasProductType && (
        <p className="text-muted-foreground mb-3 text-xs">
          Assign a product type with variant-axis attributes (Admin → Types) to generate
          option combinations.
        </p>
      )}

      <div className="space-y-2">
        {(variants ?? []).map((v) => (
          <VariantRowEditor
            key={v.id}
            variant={v}
            productId={productId}
            onRemove={handleRemove}
            onSetDefault={() => setDefault.mutate(v.id)}
          />
        ))}
        {variants?.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-xs">
            No variants — this product sells at product-level price/stock.
          </p>
        )}
      </div>

      {adding && (
        <div className="mt-3 space-y-2 rounded-xl border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="v-title">Title (options)</Label>
              <Input
                id="v-title"
                placeholder="M / Red"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-sku">SKU</Label>
              <Input
                id="v-sku"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-price">Price (USD)</Label>
              <Input
                id="v-price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-stock">Stock</Label>
              <Input
                id="v-stock"
                inputMode="numeric"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="xs"
              disabled={create.isPending || !form.title || !form.sku || !form.price}
              onClick={() => create.mutate()}
            >
              Save variant
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function VariantRowEditor({
  variant,
  productId,
  onRemove,
  onSetDefault,
}: {
  variant: VariantRow
  productId: string
  onRemove: (variantId: string) => void
  onSetDefault: () => void
}) {
  const queryClient = useQueryClient()
  const [price, setPrice] = useState(centsToDecimalString(variant.priceCents))
  const [stock, setStock] = useState(String(variant.stock))
  const [sku, setSku] = useState(variant.sku)
  const dirty = price !== centsToDecimalString(variant.priceCents) || stock !== String(variant.stock) || sku !== variant.sku

  const save = useMutation({
    mutationFn: () =>
      upsertVariant({
        data: {
          productId,
          variantId: variant.id,
          title: variant.title,
          sku,
          priceCents: parsePriceToCents(price) ?? variant.priceCents,
          stock: Number(stock || "0"),
          options: variant.options,
          status: variant.status === "draft" ? "draft" : "active",
        },
      }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Variant saved")
      void queryClient.invalidateQueries({ queryKey: ["variants", productId] })
      void queryClient.invalidateQueries({ queryKey: ["product-edit", productId] })
      void queryClient.invalidateQueries({ queryKey: ["product"] })
    },
  })

  return (
    <div className="rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{variant.title}</span>
        {variant.isDefault && (
          <Badge variant="secondary">
            <Star className="size-3" /> default
          </Badge>
        )}
        {variant.status !== "active" && <Badge variant="outline">{variant.status}</Badge>}
        <span className="ml-auto text-muted-foreground text-xs">{formatMoney(variant.priceCents)}</span>
      </div>
      {variant.options.length > 0 && (
        <p className="text-muted-foreground mt-1 text-xs">
          {variant.options.map((o) => o.value).join(" / ")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">SKU</Label>
          <Input className="w-32" value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Price (USD)</Label>
          <Input className="w-24" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Stock</Label>
          <Input className="w-20" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
        </div>
        {dirty && (
          <Button size="xs" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        )}
        {!variant.isDefault && (
          <Button size="xs" variant="outline" onClick={onSetDefault}>
            Set default
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => onRemove(variant.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

