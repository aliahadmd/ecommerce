import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
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

export const Route = createFileRoute("/reset-password")({
  validateSearch: z.object({ token: z.string().optional() }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const navigate = useNavigate()
  const { token } = Route.useSearch()
  const [password, setPassword] = useState("")

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!token) {
      toast.error("Missing reset token")
      return
    }
    const { error } = await authClient.resetPassword({ token, newPassword: password })
    if (error) {
      toast.error(error.message ?? "Could not reset password")
      return
    }
    toast.success("Password updated — sign in with your new password")
    void navigate({ to: "/login" })
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>
            <Link to="/login" className="underline">
              Back to sign in
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full">
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
