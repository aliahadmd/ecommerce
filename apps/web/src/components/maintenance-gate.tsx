import { useQuery } from "@tanstack/react-query"
import { getStoreSettings } from "@/server/settings"

/**
 * Full-screen maintenance notice for non-admin visitors (plan-8).
 * Server enforcement note: admin API routes remain independently guarded.
 */
export function MaintenanceGate({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  const { data: settings } = useQuery({
    queryKey: ["store-settings-public"],
    queryFn: () => getStoreSettings().then((r) => (r.ok ? r.data : null)),
    staleTime: 30_000,
  })

  if (settings?.mode === "maintenance" && !isAdmin) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-2 px-4 text-center">
        <h1 className="text-2xl font-bold">We'll be right back</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          {settings.contactEmail
            ? `The store is temporarily closed for maintenance. Questions? ${settings.contactEmail}`
            : "The store is temporarily closed for maintenance."}
        </p>
      </main>
    )
  }
  return <>{children}</>
}
