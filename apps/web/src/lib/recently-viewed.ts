import { useStore, createStore  } from "@tanstack/react-store"

/** Plan-8: recently viewed slugs (max 12) in localStorage, newest first. */
const MAX = 12
const KEY = "recently-viewed"

function read(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.map(String).slice(0, MAX) : []
  } catch {
    return []
  }
}

export const recentlyViewedStore = createStore<{ slugs: string[] }>({ slugs: [] })

/** Call on the product detail page (client only). */
export function trackRecentlyViewed(slug: string) {
  const slugs = read().filter((s) => s !== slug)
  const next = [slug, ...slugs].slice(0, MAX)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage full/blocked — ignore
  }
  recentlyViewedStore.setState(() => ({ slugs: next }))
}

/** Hydrates the store from localStorage; call once in the home page component. */
export function useRecentlyViewed(): string[] {
  const state = useStore(recentlyViewedStore, (s) => s.slugs)
  // first call hydrates (useState initializer would double-run; store is fine)
  if (typeof window !== "undefined" && state.length === 0) {
    const slugs = read()
    if (slugs.length > 0 && recentlyViewedStore.get().slugs.length === 0) {
      recentlyViewedStore.setState(() => ({ slugs }))
    }
  }
  return state
}
