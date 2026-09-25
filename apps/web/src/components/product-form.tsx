import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { getCategories, getTags } from "@/server/catalog"
import { aiStatus, generateDescription, suggestTags } from "@/server/ai"
import { getTypeAttributeDefinitions, listProductTypeOptions } from "@/server/attributes"
import { unwrap } from "@/lib/unwrap"
import { Sparkles } from "lucide-react"
import { cn } from "cn"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const stockSchema = z.string().min(1, "Required").regex(/^\d+$/, "Whole number")

const productFormSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  price: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter a price like 12.34"),
  stock: stockSchema,
  categoryId: z.string().nullable(),
  tagIds: z.array(z.string()),
  status: z.enum(["draft", "active"]),
  brand: z.string().max(80),
  summary: z.string().max(300),
  condition: z.enum(["new", "used", "refurbished"]),
  weightGrams: z
    .string()
    .regex(/^\d*$/, "Whole grams")
    .max(7),
  dimensions: z.object({
    l: z.string().regex(/^\d*$/, "mm"),
    w: z.string().regex(/^\d*$/, "mm"),
    h: z.string().regex(/^\d*$/, "mm"),
  }),
  seoTitle: z.string().max(200),
  seoDescription: z.string().max(300),
  lowStockThreshold: stockSchema,
  productTypeId: z.string().nullable(),
  attributes: z.array(z.object({ attributeId: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]) })),
})

export type SpecValue = string | number | boolean | string[]

export interface ProductFormValues {
  title: string
  description: string
  price: string
  stock: string
  categoryId: string | null
  tagIds: string[]
  status: "draft" | "active"
  brand: string
  summary: string
  condition: "new" | "used" | "refurbished"
  weightGrams: string
  dimensions: { l: string; w: string; h: string }
  seoTitle: string
  seoDescription: string
  lowStockThreshold: string
  productTypeId: string | null
  attributes: { attributeId: string; value: SpecValue }[]
}

function errMsg(e: unknown): string {
  return typeof e === "string"
    ? e
    : ((e as { message?: string })?.message ?? "Invalid")
}

/** Shared between the create and edit pages (plan-7). */
export function ProductForm({
  defaultValues,
  submitLabel,
  onSubmit,
  pending,
  hidePriceStock = false,
}: {
  defaultValues: ProductFormValues
  submitLabel: string
  onSubmit: (values: ProductFormValues) => void
  pending?: boolean
  hidePriceStock?: boolean
}) {
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories().then(unwrap),
  })
  const { data: tags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => getTags().then(unwrap),
  })
  const { data: ai } = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiStatus().then(unwrap),
    staleTime: 60_000,
  })
  const [suggestions, setSuggestions] = useState<string[]>([])

  const genDesc = useMutation({
    mutationFn: (values: {
      title: string
      categoryName: string | null
      tagNames: string[]
    }) => generateDescription({ data: values }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      form.setFieldValue("description", r.data.description)
      toast.success("Description generated — review and edit")
    },
    onError: (e) => toast.error(e.message),
  })
  const genTags = useMutation({
    mutationFn: (values: { title: string; description: string }) =>
      suggestTags({ data: values }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      setSuggestions(r.data.suggestions)
      if (r.data.suggestions.length === 0) toast.info("No tag suggestions")
    },
    onError: (e) => toast.error(e.message),
  })

  const [specValues, setSpecValues] = useState<Record<string, SpecValue>>(
    Object.fromEntries((defaultValues.attributes ?? []).map((a) => [a.attributeId, a.value])),
  )
  const { data: typeOptions } = useQuery({
    queryKey: ["product-type-options"],
    queryFn: () => listProductTypeOptions().then(unwrap),
    staleTime: 60_000,
  })
  const selectedTypeId = defaultValues.productTypeId
  const { data: specDefs } = useQuery({
    queryKey: ["type-attributes", selectedTypeId],
    queryFn: () => getTypeAttributeDefinitions({ data: { productTypeId: selectedTypeId } }).then(unwrap),
    staleTime: 60_000,
  })

  const form = useForm({
    defaultValues,
    validators: { onSubmit: productFormSchema },
    onSubmit: ({ value }) =>
      onSubmit({
        title: value.title,
        description: value.description,
        price: value.price,
        stock: value.stock,
        categoryId: value.categoryId || null,
        tagIds: value.tagIds,
        status: value.status,
        brand: value.brand.trim() || "",
        summary: value.summary.trim() || "",
        condition: value.condition,
        weightGrams: value.weightGrams.trim() || "",
        dimensions: value.dimensions,
        seoTitle: value.seoTitle.trim() || "",
        seoDescription: value.seoDescription.trim() || "",
        lowStockThreshold: value.lowStockThreshold.trim() || "5",
        productTypeId: value.productTypeId,
        attributes: Object.entries(specValues)
          .filter(([, v]) => v !== "" && v !== " ")
          .map(([attributeId, v]) => ({
            attributeId,
            value: v,
          })),
      }),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="space-y-5"
    >
      <form.Field
        name="title"
        validators={{
          onChange: z.string().min(3, "At least 3 characters").max(200),
        }}
      >
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">
                {errMsg(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field
        name="price"
        validators={{ onChange: productFormSchema.shape.price }}
      >
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="price">Price (USD)</Label>
            <Input
              id="price"
              inputMode="decimal"
              placeholder="12.34"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">
                {errMsg(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      {!hidePriceStock && (
        <form.Field name="stock" validators={{ onChange: stockSchema }}>
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="stock">Stock</Label>
              <Input
                id="stock"
                type="number"
                min={0}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-xs text-destructive">
                  {errMsg(field.state.meta.errors[0])}
                </p>
              )}
            </div>
          )}
        </form.Field>
      )}

      <form.Field
        name="description"
        validators={{
          onChange: z.string().min(10, "At least 10 characters").max(5000),
        }}
      >
        {(field) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="description">Description</Label>
              {ai?.enabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={genDesc.isPending}
                  onClick={() =>
                    genDesc.mutate({
                      title: form.getFieldValue("title"),
                      categoryName:
                        (categories ?? []).find(
                          (c) => c.id === form.getFieldValue("categoryId")
                        )?.name ?? null,
                      tagNames: (tags ?? [])
                        .filter((t) =>
                          form.getFieldValue("tagIds").includes(t.id)
                        )
                        .map((t) => t.name),
                    })
                  }
                >
                  <Sparkles className="size-3" />
                  {genDesc.isPending ? "Generating…" : "Generate description"}
                </Button>
              )}
            </div>
            <Textarea
              id="description"
              rows={6}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">
                {errMsg(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="categoryId">
        {(field) => (
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select
              value={field.state.value ?? "none"}
              onValueChange={(v) => field.handleChange(v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="tagIds">
        {(field) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Tags (max 10)</Label>
              {ai?.enabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={genTags.isPending}
                  onClick={() =>
                    genTags.mutate({
                      title: form.getFieldValue("title"),
                      description: form.getFieldValue("description"),
                    })
                  }
                >
                  <Sparkles className="size-3" />
                  {genTags.isPending ? "Thinking…" : "Suggest tags"}
                </Button>
              )}
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions
                  .filter(
                    (name) =>
                      !(tags ?? []).some(
                        (t) =>
                          field.state.value.includes(t.id) && t.name === name
                      )
                  )
                  .map((name) => {
                    const tag = (tags ?? []).find((t) => t.name === name)
                    if (!tag || field.state.value.includes(tag.id)) return null
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                        onClick={() =>
                          field.handleChange([...field.state.value, tag.id])
                        }
                      >
                        + {name}
                      </button>
                    )
                  })}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {(tags ?? []).map((t) => {
                const checked = field.state.value.includes(t.id)
                return (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        field.handleChange(
                          v
                            ? [...field.state.value, t.id]
                            : field.state.value.filter((id) => id !== t.id)
                        )
                      }
                    />
                    {t.name}
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </form.Field>

      <div className="border-t pt-4">
        <h3 className="mb-3 text-sm font-medium">Type & specifications</h3>
        <div className="space-y-4">
          <form.Field name="productTypeId">
            {(field) => (
              <div className="space-y-1.5">
                <Label>Product type</Label>
                <Select
                  value={field.state.value ?? "none"}
                  onValueChange={(v) => field.handleChange(v === "none" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No type</SelectItem>
                    {(typeOptions ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          {(specDefs ?? []).map((def) => (
            <div key={def.id} className="space-y-1.5">
              <Label>
                {def.name}
                {def.unit ? <span className="text-muted-foreground"> ({def.unit})</span> : null}
                {def.required && <span className="text-destructive"> *</span>}
              </Label>
              {def.kind === "boolean" ? (
                <Checkbox
                  checked={specValues[def.id] === true}
                  onCheckedChange={(v) =>
                    setSpecValues((prev) => ({ ...prev, [def.id]: v === true }))
                  }
                />
              ) : def.kind === "select" ? (
                <Select
                  value={String(specValues[def.id] ?? "")}
                  onValueChange={(v) => setSpecValues((prev) => ({ ...prev, [def.id]: v ?? " " }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=" ">—</SelectItem>
                    {def.options.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : def.kind === "multiselect" ? (
                <div className="flex flex-wrap gap-1.5">
                  {def.options.map((o) => {
                    const current = Array.isArray(specValues[def.id])
                      ? (specValues[def.id] as string[])
                      : []
                    const checked = current.includes(o)
                    return (
                      <button
                        key={o}
                        type="button"
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs",
                          checked && "bg-primary text-primary-foreground",
                        )}
                        onClick={() =>
                          setSpecValues((prev) => ({
                            ...prev,
                            [def.id]: checked
                              ? current.filter((c) => c !== o)
                              : [...current, o],
                          }))
                        }
                      >
                        {o}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <Input
                  type={def.kind === "number" ? "number" : "text"}
                  value={String(specValues[def.id] ?? "")}
                  onChange={(e) =>
                    setSpecValues((prev) => ({
                      ...prev,
                      [def.id]:
                        def.kind === "number"
                          ? e.target.value === ""
                            ? ""
                            : Number(e.target.value)
                          : e.target.value,
                    }))
                  }
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="mb-3 text-sm font-medium">Details</h3>
        <div className="space-y-4">
          <form.Field name="brand" validators={{ onChange: productFormSchema.shape.brand }}>
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="brand">Brand</Label>
                <Input
                  id="brand"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="summary" validators={{ onChange: productFormSchema.shape.summary }}>
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="summary">
                  Short summary{" "}
                  <span className="text-muted-foreground">({field.state.value.length}/300)</span>
                </Label>
                <Textarea
                  id="summary"
                  rows={2}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="condition">
            {(field) => (
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <RadioGroup
                  value={field.state.value}
                  onValueChange={(v) => field.handleChange(v as "new" | "used" | "refurbished")}
                  className="flex gap-4"
                >
                  {(["new", "used", "refurbished"] as const).map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm capitalize">
                      <RadioGroupItem value={c} /> {c}
                    </label>
                  ))}
                </RadioGroup>
              </div>
            )}
          </form.Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <form.Field name="weightGrams" validators={{ onChange: productFormSchema.shape.weightGrams }}>
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="weight">Weight (g)</Label>
                  <Input
                    id="weight"
                    inputMode="numeric"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>
            {(["l", "w", "h"] as const).map((axis) => (
              <form.Field key={axis} name={`dimensions.${axis}`} validators={{ onChange: productFormSchema.shape.dimensions.shape[axis] }}>
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor={`dim-${axis}`}>{axis.toUpperCase()} (mm)</Label>
                    <Input
                      id={`dim-${axis}`}
                      inputMode="numeric"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            ))}
          </div>
          <form.Field
            name="lowStockThreshold"
            validators={{ onChange: productFormSchema.shape.lowStockThreshold }}
          >
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="lowStock">Low-stock alert at</Label>
                <Input
                  id="lowStock"
                  inputMode="numeric"
                  className="max-w-24"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="mb-3 text-sm font-medium">SEO (optional)</h3>
        <div className="space-y-4">
          <form.Field name="seoTitle" validators={{ onChange: productFormSchema.shape.seoTitle }}>
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="seoTitle">SEO title</Label>
                <Input
                  id="seoTitle"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field
            name="seoDescription"
            validators={{ onChange: productFormSchema.shape.seoDescription }}
          >
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="seoDesc">SEO description</Label>
                <Textarea
                  id="seoDesc"
                  rows={2}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
        </div>
      </div>

      <form.Field name="status">
        {(field) => (
          <div className="space-y-1.5">
            <Label>Visibility</Label>
            <RadioGroup
              value={field.state.value}
              onValueChange={(v) => field.handleChange(v as "draft" | "active")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="draft" /> Draft (hidden)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="active" /> Active (published)
              </label>
            </RadioGroup>
          </div>
        )}
      </form.Field>

      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  )
}
