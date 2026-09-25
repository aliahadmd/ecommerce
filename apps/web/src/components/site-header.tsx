import { Link, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { authClient } from "@ecommerce/auth/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { roleLabels } from "@/lib/role"
import { useCartCount } from "@/lib/cart-store"
import { getSession, type AppUser } from "@/server/session"
import { ShoppingBag, Search, LogOut, User, Store, Shield } from "lucide-react"

/** Search + cart + role-aware account menu. Re-renders from root context. */
export function Header({ user }: { user: AppUser | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const cartCount = useCartCount()

  async function handleSignOut() {
    await authClient.signOut()
    queryClient.clear()
    await navigate({ to: "/" })
    // Reload so the root loader picks up the cleared session everywhere.
    window.location.reload()
  }

  async function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = new FormData(e.currentTarget).get("q")
    await navigate({ to: "/products", search: q ? { q: String(q) } : {} })
  }

  return (
    <header className="bg-background/80 supports-backdrop-filter:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <ShoppingBag className="size-5" />
          <span>Ecommerce</span>
        </Link>

        <form onSubmit={handleSearch} className="relative ml-2 flex-1 max-w-md">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            name="q"
            placeholder="Search products…"
            className="pl-8"
            autoComplete="off"
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          <Button
            render={<Link to="/cart" search={{}} />}
            variant="ghost"
            size="icon"
            aria-label="Cart"
          >
            <ShoppingBag className="size-5" />
            {cartCount > 0 && (
              <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[10px] font-bold">
                {cartCount}
              </span>
            )}
          </Button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="gap-2 px-2">
                    <Avatar className="size-6">
                      <AvatarImage src={user.image ?? undefined} />
                      <AvatarFallback>
                        {user.name.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-24 truncate sm:inline">
                      {user.name}
                    </span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate">{user.email}</div>
                  <div className="text-muted-foreground text-xs font-normal">
                    {roleLabels[user.role]}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link to="/account" />}>
                  <User className="size-4" /> My account
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link to="/account/orders" search={{}} />}>
                  <ShoppingBag className="size-4" /> My orders
                </DropdownMenuItem>
                {user.role !== "buyer" && (
                  <DropdownMenuItem render={<Link to="/seller" />}>
                    <Store className="size-4" /> Seller dashboard
                  </DropdownMenuItem>
                )}
                {user.role === "super_admin" && (
                  <DropdownMenuItem render={<Link to="/admin" />}>
                    <Shield className="size-4" /> Admin dashboard
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleSignOut()}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button render={<Link to="/login" />} variant="ghost">
                Sign in
              </Button>
              <Button render={<Link to="/register" />}>Register</Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

// Re-exported so route components can refetch the session without importing
// the server module graph directly.
export { getSession }
