import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@ecommerce/auth"

/** Mounts better-auth at /api/auth/* (plan-5). */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
})
