import type { EmailJobData, NotifyJobData } from "./queues"
import {
  sendOrderCancelledEmail,
  sendOrderPlacedEmail,
  sendOrderStatusEmail,
  sendPasswordResetEmail,
  sendPaymentReceivedEmail,
  sendVerificationEmail,
} from "@ecommerce/email"
import { db } from "@ecommerce/db"
import { notifications } from "@ecommerce/db/schema"

export async function handleEmailJob(job: EmailJobData): Promise<void> {
  const p = job.payload as Record<string, string>
  switch (job.template) {
    case "verification":
      await sendVerificationEmail(job.to, p.url)
      break
    case "password_reset":
      await sendPasswordResetEmail(job.to, p.url)
      break
    case "order_placed":
      await sendOrderPlacedEmail(job.to, {
        orderNumber: p.orderNumber,
        items: JSON.parse(p.items ?? "[]"),
        totalFormatted: p.totalFormatted,
        shipAddress: p.shipAddress,
      })
      break
    case "order_status":
      await sendOrderStatusEmail(job.to, p.orderNumber, p.status)
      break
    case "payment_received":
      await sendPaymentReceivedEmail(job.to, p.orderNumber, p.totalFormatted)
      break
    case "order_cancelled":
      await sendOrderCancelledEmail(job.to, p.orderNumber, p.reason || null)
      break
    case "back_in_stock":
      await sendOrderPlacedEmail(job.to, {
        orderNumber: "back-in-stock",
        items: [{ title: p.productTitle, quantity: 1, totalFormatted: "" }],
        totalFormatted: "",
        shipAddress: "",
      })
      break
  }
}

export async function handleNotifyJob(job: NotifyJobData): Promise<void> {
  await db.insert(notifications).values({
    userId: job.userId,
    kind: job.kind,
    title: job.title,
    body: job.body,
    link: job.link,
  })
}
