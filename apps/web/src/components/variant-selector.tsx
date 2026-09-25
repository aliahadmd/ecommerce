import { useMemo, useState } from "react"
import { cn } from "cn"

export interface VariantOption {
  attributeId: string
  value: string
}

export interface VariantLite {
  id: string
  sku: string
  title: string
  priceCents: number
  stock: number
  imageId: string | null
  isDefault: boolean
  options: VariantOption[]
}

/**
 * Plan-5 storefront selector: one select per variant axis; tracks the chosen
 * combination and resolves it to a variant. Disabled when the product has no
 * variants (phase-1 single-SKU shape).
 */
export function useVariantSelection(variants: VariantLite[]) {
  const axes = useMemo(() => {
    const byId = new Map<string, { attributeId: string; values: Set<string> }>()
    for (const v of variants) {
      for (const o of v.options) {
        const axis = byId.get(o.attributeId) ?? { attributeId: o.attributeId, values: new Set() }
        axis.values.add(o.value)
        byId.set(o.attributeId, axis)
      }
    }
    return [...byId.values()].map((a) => ({ attributeId: a.attributeId, values: [...a.values] }))
  }, [variants])

  const [chosen, setChosen] = useState<Record<string, string>>({})

  const selected = useMemo(() => {
    if (variants.length === 0) return null
    if (axes.length === 0) return variants.find((v) => v.isDefault) ?? variants[0] ?? null
    const match = variants.find(
      (v) =>
        v.options.length === axes.length &&
        axes.every((axis) => {
          const opt = v.options.find((o) => o.attributeId === axis.attributeId)
          return opt && chosen[axis.attributeId] === opt.value
        }),
    )
    return match ?? null
  }, [variants, axes, chosen])

  // availability per axis value: at least one active variant with that value
  // combined with the other currently-chosen axes
  function isValueSelectable(axisAttributeId: string, value: string): boolean {
    return variants.some((v) => {
      const hasThis = v.options.some(
        (o) => o.attributeId === axisAttributeId && o.value === value,
      )
      if (!hasThis) return false
      const othersOk = axes
        .filter((a) => a.attributeId !== axisAttributeId)
        .every((a) => {
          const wanted = chosen[a.attributeId]
          if (!wanted) return true
          return v.options.some(
            (o) => o.attributeId === a.attributeId && o.value === wanted,
          )
        })
      return othersOk && v.stock > 0
    })
  }

  return { axes, chosen, setChosen, selected, isValueSelectable }
}

export function VariantSelectors({
  axes,
  chosen,
  setChosen,
  isValueSelectable,
}: {
  axes: { attributeId: string; values: string[] }[]
  chosen: Record<string, string>
  setChosen: (next: Record<string, string>) => void
  isValueSelectable: (attributeId: string, value: string) => boolean
}) {
  if (axes.length === 0) return null
  return (
    <div className="space-y-3">
      {axes.map((axis) => (
        <div key={axis.attributeId}>
          <div className="mb-1 flex gap-1.5">
            {axis.values.map((value) => {
              const selected = chosen[axis.attributeId] === value
              const selectable = isValueSelectable(axis.attributeId, value)
              return (
                <button
                  key={value}
                  type="button"
                  disabled={!selectable}
                  onClick={() => setChosen({ ...chosen, [axis.attributeId]: value })}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    selected && "bg-primary text-primary-foreground",
                    !selectable && "cursor-not-allowed opacity-40 line-through",
                  )}
                >
                  {value}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
