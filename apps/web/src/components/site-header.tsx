import { useEffect } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { authClient } from "@ecommerce/auth/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getCart } from "@/lib/cart-rpc"
import { roleLabels } from "@/lib/role"
import { setCartCount, useCartCount } from "@/lib/cart-store"
import { Bell, ShoppingBag, Search, LogOut, Moon, Shield, Store, Sun, User  } from "lucide-react"
import { initTheme, toggleTheme, useTheme } from "@/lib/theme"
import type { AppUser } from "@/server/session"

/** Search + cart + role-aware account menu. Re-renders from root context. */
export function Header({ user }: { user: AppUser | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const cartCount = useCartCount()

  useEffect(() => {
    initTheme()
  }, [])

  // Keep the badge honest across reloads (the store starts at 0).
  useEffect(() => {
    if (!user) {
      setCartCount(0)
      return
    }
    getCart()
      .then((r) => {
        if (r.ok) setCartCount(r.data.count)
      })
      .catch(() => undefined)
  }, [user])

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
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <ShoppingBag className="size-5" />
          <span>Ecommerce</span>
        </Link>

        <form onSubmit={handleSearch} className="relative ml-2 max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            placeholder="Search products…"
            className="pl-8"
            autoComplete="off"
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user && (
            <Button
              render={<Link to="/account/notifications" />}
              variant="ghost"
              size="icon"
              aria-label="Notifications"
            >
              <Bell className="size-4" />
            </Button>
          )}
          <Button
            render={<Link to="/cart" search={{}} />}
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Cart"
          >
            <ShoppingBag className="size-5" />
            {cartCount > 0 && (
              <span
                key={cartCount}
                className="animate-pop absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
              >
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
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="truncate">{user.email}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {roleLabels[user.role]}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link to="/account" />}>
                  <User className="size-4" /> My account
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<Link to="/account/orders" search={{}} />}
                >
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

function ThemeToggle() {
  const theme = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={toggleTheme}
    >
      {theme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  )
}

