import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { roleLabels } from "@/lib/role"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export const Route = createFileRoute("/account/")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: "/account" } })
    }
  },
  component: AccountPage,
})

function AccountPage() {
  const { session } = Route.useRouteContext()
  const user = session!

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader className="flex-row items-center gap-4">
          <Avatar className="size-14">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="text-lg">
              {user.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <CardTitle className="text-xl">{user.name}</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </div>
          <Badge variant="secondary">{roleLabels[user.role]}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {!user.emailVerified && (
            <p className="text-sm text-destructive">
              Your email is not verified yet — check Mailpit for the link.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              render={<Link to="/account/orders" search={{}} />}
              variant="outline"
            >
              My orders
            </Button>
            <Button
              render={<Link to="/account/addresses" search={{}} />}
              variant="outline"
            >
              Addresses
            </Button>
            {user.role === "buyer" && user.emailVerified && (
              <Button render={<Link to="/seller/onboarding" />}>
                Become a seller
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
