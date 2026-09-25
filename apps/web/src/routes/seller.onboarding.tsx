import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { toast } from "sonner"
import { createShop } from "@/server/shops"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export const Route = createFileRoute("/seller/onboarding")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({
        to: "/login",
        search: { redirect: "/seller/onboarding" },
      })
    }
    if (context.session.role === "seller") {
      throw redirect({ to: "/seller" })
    }
  },
  component: SellerOnboardingPage,
})

function errMsg(e: unknown): string {
  return typeof e === "string"
    ? e
    : ((e as { message?: string })?.message ?? "Invalid")
}

function SellerOnboardingPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const { session } = Route.useRouteContext()

  const form = useForm({
    defaultValues: { name: "", description: "" },
    onSubmit: async ({ value }) => {
      const result = await createShop({
        data: { name: value.name, description: value.description || undefined },
      })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      await router.invalidate()
      toast.success("Shop created — welcome aboard, seller!")
      await navigate({ to: "/seller" })
    },
  })

  if (session && !session.emailVerified) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Verify your email first</CardTitle>
            <CardDescription>
              You need a verified email address before opening a shop. Check
              Mailpit for the link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to="/verify-email" />} variant="outline">
              Resend verification
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Open your shop</CardTitle>
          <CardDescription>
            One shop per account. You'll be able to list products and manage
            orders right after.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void form.handleSubmit()
            }}
            className="space-y-4"
          >
            <form.Field
              name="name"
              validators={{
                onChange: z.string().min(3, "At least 3 characters").max(80),
              }}
            >
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Shop name</Label>
                  <Input
                    id="name"
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
              name="description"
              validators={{
                onChange: z.string().max(500, "Max 500 characters"),
              }}
            >
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    rows={3}
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
            <Button type="submit" className="w-full">
              Create shop
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
