import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"

import appCss from "../styles.css?url"
import type { QueryClient } from "@tanstack/react-query"
import { Header } from "@/components/site-header"
import { Toaster } from "@/components/ui/sonner"
import { unwrap } from "@/lib/unwrap"
import { getSession } from "@/server/session"
import { getStoreSettings } from "@/server/settings"
import { useQuery } from "@tanstack/react-query"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          title: "Ecommerce — multi-vendor marketplace",
        },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
      ],
      scripts: [
        {
          // Apply the persisted theme before first paint (no flash)
          children: `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
        },
      ],
    }),
    // Loaded on the server for SSR and re-checked on every client navigation.
    beforeLoad: async () => {
      const session = await getSession()
      return { session }
    },
    notFoundComponent: () => (
      <main className="container mx-auto p-4 pt-16">
        <h1>404</h1>
        <p>The requested page could not be found.</p>
      </main>
    ),
    component: RootComponent,
    shellComponent: RootDocument,
  }
)

function RootComponent() {
  const { session } = Route.useRouteContext()
  const settingsQuery = useQuery({
    queryKey: ["store-settings-public"],
    queryFn: () => getStoreSettings().then(unwrap),
    staleTime: 30_000,
  })
  const storeSettings = settingsQuery.data
  const isAdmin = session?.role === "super_admin"
  const maintenance = storeSettings?.mode === "maintenance" && !isAdmin
  return (
    <>
      <Header user={session} />
      {maintenance ? (
        <main className="flex min-h-svh flex-col items-center justify-center gap-2 px-4 text-center">
          <h1 className="text-2xl font-bold">We'll be right back</h1>
          <p className="text-muted-foreground max-w-md text-sm">
            The store is temporarily closed for maintenance.
            {storeSettings?.contactEmail ? ` Questions? ${storeSettings.contactEmail}` : ""}
          </p>
        </main>
      ) : (
        <Outlet />
      )}
      <Toaster position="bottom-right" richColors />
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{
              position: "bottom-right",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
