import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  listNotifications,
  markNotificationsRead,
} from "@/server/notifications"
import { unwrap } from "@/lib/unwrap"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

export const Route = createFileRoute("/account/notifications")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({
        to: "/login",
        search: { redirect: "/account/notifications" },
      })
    }
  },
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["notifications", {}],
      queryFn: () => listNotifications({ data: {} }).then(unwrap),
    })
  },
  component: NotificationsPage,
})

function NotificationsPage() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["notifications", {}],
    queryFn: () => listNotifications({ data: {} }).then(unwrap),
  })

  const markAll = useMutation({
    mutationFn: () => markNotificationsRead({ data: { all: true } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] })
    },
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Button render={<Link to="/account" search={{}} />} variant="ghost" size="sm" className="mb-4">
        ← My account
      </Button>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notifications</h1>
        {(data?.rows ?? []).some((n) => !n.readAt) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {(data?.rows ?? []).map((n) => (
          <div
            key={n.id}
            className={cn(
              "rounded-xl border p-4 text-sm",
              !n.readAt && "bg-muted/40"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{n.title}</span>
              <span className="text-muted-foreground text-xs">
                {new Date(n.createdAt).toLocaleString()}
              </span>
            </div>
            {n.body && <p className="text-muted-foreground mt-1">{n.body}</p>}
          </div>
        ))}
        {data?.rows.length === 0 && (
          <p className="text-muted-foreground py-16 text-center text-sm">
            No notifications yet.
          </p>
        )}
      </div>
    </main>
  )
}
