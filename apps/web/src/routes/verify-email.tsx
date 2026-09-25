import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"
import { toast } from "sonner"
import { authClient } from "@ecommerce/auth/client"
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

export const Route = createFileRoute("/verify-email")({
  validateSearch: z.object({ token: z.string().optional() }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const router = useRouter()
  const { token } = Route.useSearch()
  const [state, setState] = useState<"pending" | "success" | "error">(
    token ? "pending" : "error"
  )
  const [message, setMessage] = useState("")
  const ran = useRef(false)

  useEffect(() => {
    if (!token || ran.current) return
    ran.current = true
    void authClient
      .verifyEmail({ query: { token } })
      .then(({ error }) => {
        if (error) {
          setState("error")
          setMessage(error.message ?? "Verification failed")
        } else {
          setState("success")
          void router.invalidate()
        }
      })
      .catch(() => {
        setState("error")
        setMessage("Verification failed")
      })
  }, [token, router])

  async function resend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = String(new FormData(e.currentTarget).get("email") ?? "")
    const { error } = await authClient.sendVerificationEmail({ email })
    if (error) toast.error(error.message ?? "Could not resend")
    else toast.success("Verification email sent — check Mailpit")
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Email verification</CardTitle>
          {!token && (
            <CardDescription>
              Open the verification link from your email, or resend it below.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "pending" && <p>Verifying…</p>}
          {state === "success" && (
            <>
              <p className="text-sm">
                Your email is verified — you're signed in.
              </p>
              <Button render={<Link to="/" />} className="w-full">
                Start shopping
              </Button>
            </>
          )}
          {state === "error" && (
            <>
              {message && <p className="text-sm text-destructive">{message}</p>}
              <form onSubmit={resend} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
                <Button type="submit" variant="outline" className="w-full">
                  Resend verification email
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
