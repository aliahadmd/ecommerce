import { createStore, useStore } from "@tanstack/react-store"

/**
 * Class-based dark mode (Tailwind `@custom-variant dark (&:is(.dark *))`).
 * Persisted in localStorage; no flash thanks to the inline script in __root.
 */
type Theme = "light" | "dark"

export const themeStore = createStore<{ theme: Theme }>({
  theme: typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light",
})

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export function initTheme() {
  const saved = localStorage.getItem("theme")
  const theme: Theme = saved === "dark" || saved === "light" ? saved : themeStore.get().theme
  themeStore.setState(() => ({ theme }))
  applyTheme(theme)
}

export function toggleTheme() {
  const next: Theme = themeStore.get().theme === "dark" ? "light" : "dark"
  themeStore.setState(() => ({ theme: next }))
  localStorage.setItem("theme", next)
  applyTheme(next)
}

export function useTheme(): Theme {
  return useStore(themeStore, (s) => s.theme)
}
