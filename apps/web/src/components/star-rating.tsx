import { Star } from "lucide-react"
import { cn } from "cn"

/** Star row rendering `value` (0–5, halves supported via a clipped overlay). */
export function StarRating({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  const clamped = Math.max(0, Math.min(5, value))
  return (
    <span className="relative inline-flex" aria-label={`${clamped.toFixed(1)} out of 5 stars`}>
      <span className="text-muted-foreground/40 flex">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className={cn("size-4", className)} />
        ))}
      </span>
      <span
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${(clamped / 5) * 100}%` }}
      >
        <span className="flex text-amber-400">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className={cn("size-4 fill-amber-400", className)} />
          ))}
        </span>
      </span>
    </span>
  )
}
