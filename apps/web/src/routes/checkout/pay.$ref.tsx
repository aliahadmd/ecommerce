import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * DEV FAKE GATEWAY (plan-3): simulates a hosted payment page. Never exposed
 * in production — PAYMENT_PROVIDER=stripe replaces this flow.
 */
export const Route = createFileRoute("/checkout/pay/$ref")({
  component: FakePayPage,
})

function FakePayPage() {
  const { ref } = Route.useParams()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)

  async function pay(outcome: "succeeded" | "failed") {
    setBusy(outcome)
    // sign via the server (the signature secret never reaches the client)
    const res = await fetch("/api/payments/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, outcome }),
    })
    const { sig } = (await res.json()) as { sig?: string }
    if (!sig) {
      setBusy(null)
      return
    }
    const cb = await fetch("/api/payments/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, outcome, sig }),
    })
    const result = (await cb.json()) as { ok: boolean }
    setBusy(null)
    if (result.ok && outcome === "succeeded") {
      void navigate({ to: "/account/orders" })
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>DEV GATEWAY</CardTitle>
          <CardDescription>
            Simulated payment page for ref {ref.slice(0, 24)}…
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button onClick={() => void pay("succeeded")} disabled={!!busy}>
            {busy === "succeeded" ? "Processing…" : "Pay now"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void pay("failed")}
            disabled={!!busy}
          >
            Simulate failure
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
