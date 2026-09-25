import type { Role } from "@/server/session"

export const roleLabels: Record<Role, string> = {
  super_admin: "Super admin",
  seller: "Seller",
  buyer: "Buyer",
}

/** Where each role lands after sign-in. */
export function homeForRole(role: Role): string {
  switch (role) {
    case "super_admin":
      return "/admin"
    case "seller":
      return "/seller"
    default:
      return "/"
  }
}
