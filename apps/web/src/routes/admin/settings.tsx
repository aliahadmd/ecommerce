import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  getStoreSettings,
  updateStoreSettings,
} from "@/server/settings"
import { unwrap } from "@/lib/unwrap"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  const { data: settings } = useQuery({
    queryKey: ["store-settings"],
    queryFn: () => getStoreSettings().then(unwrap),
  })
  const [mode, setMode] = useState<"open" | "maintenance">("open")
  const [signups, setSignups] = useState(true)
  const [commission, setCommission] = useState("10")
  const [contact, setContact] = useState("")

  useEffect(() => {
    if (settings) {
      setMode(settings.mode)
      setSignups(settings.signupsEnabled)
      setCommission(String(settings.commissionRate))
      setContact(settings.contactEmail)
    }
  }, [settings])

  const save = useMutation({
    mutationFn: () =>
      updateStoreSettings({
        data: {
          mode,
          signupsEnabled: signups,
          commissionRate: Number(commission),
          contactEmail: contact,
        },
      }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Settings saved")
    },
  })

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold">Store settings</h1>

      <div className="rounded-xl border p-4 space-y-4">
        <h2 className="text-sm font-medium">Store</h2>
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "open" | "maintenance")}
            className="flex gap-4"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="open" /> Open
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="maintenance" /> Maintenance
            </label>
          </RadioGroup>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact">Contact email</Label>
          <Input id="contact" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <h2 className="text-sm font-medium">Signups</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={signups}
            onChange={(e) => setSignups(e.target.checked)}
          />
          Allow new customer registration
        </label>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <h2 className="text-sm font-medium">Commerce</h2>
        <div className="space-y-1.5">
          <Label htmlFor="commission">Commission rate (%, 0–50)</Label>
          <Input
            id="commission"
            type="number"
            min={0}
            max={50}
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            className="max-w-24"
          />
          <p className="text-muted-foreground text-xs">
            Seller keeps {100 - Number(commission || "0")}% of each sale.
          </p>
        </div>
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  )
}
