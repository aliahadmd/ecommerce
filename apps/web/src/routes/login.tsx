import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { toast } from "sonner"
import { authClient } from "@ecommerce/auth/client"
import { homeForRole } from "@/lib/role"
import { getSession } from "@/server/session"
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

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: LoginPage,
})

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as { message?: string })?.message ?? "Invalid"
}

function LoginPage() {
  const router = useRouter()
  const navigate = useNavigate()
  const { redirect } = Route.useSearch()

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      })
      if (error) {
        toast.error(error.message ?? "Sign in failed")
        return
      }
      // Refresh root loader (session) then send the user on their way.
      const session = await getSession()
      await router.invalidate()
      toast.success(`Welcome back, ${session?.name ?? ""}!`)
      const target = redirect?.startsWith("/") ? redirect : session ? homeForRole(session.role) : "/"
      await navigate({ href: target })
    },
  })

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            New here?{" "}
            <Link to="/register" className="underline">
              Create an account
            </Link>
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
              name="email"
              validators={{ onChange: z.string().min(1, "Required").email("Enter a valid email") }}
            >
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-xs">
                      {errMsg(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
            <form.Field
              name="password"
              validators={{ onChange: z.string().min(1, "Required") }}
            >
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-xs">
                      {errMsg(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
          <p className="text-muted-foreground mt-4 text-center text-xs">
            <Link to="/forgot-password" className="underline">
              Forgot your password?
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
