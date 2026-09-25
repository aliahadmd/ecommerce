import { useStore, createStore  } from "@tanstack/react-store"

/** Global UI state kept deliberately tiny (plan-9 usage map). */
export const cartStore = createStore({ count: 0 })

export function setCartCount(count: number) {
  cartStore.setState(() => ({ count }))
}

export function useCartCount(): number {
  return useStore(cartStore, (s) => s.count)
}
