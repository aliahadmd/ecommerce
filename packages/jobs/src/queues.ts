import { Queue } from "bullmq"
import { getEnv } from "@ecommerce/config"

export interface EmailJobData {
  template:
    | "verification"
    | "password_reset"
    | "order_placed"
    | "order_status"
    | "payment_received"
    | "order_cancelled"
    | "back_in_stock"
  to: string
  payload: Record<string, unknown>
  /** dedupe key — same jobId collapses while pending in the queue */
  dedupeKey: string
}

export interface NotifyJobData {
  userId: string
  kind: string
  title: string
  body: string | null
  link: string | null
  dedupeKey: string
}

let emailQueue: Queue<EmailJobData> | null = null
let notifyQueue: Queue<NotifyJobData> | null = null

function connection() {
  return { url: getEnv().REDIS_URL }
}

export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData>("email", {
      connection: connection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    })
  }
  return emailQueue
}

export function getNotifyQueue(): Queue<NotifyJobData> {
  if (!notifyQueue) {
    notifyQueue = new Queue<NotifyJobData>("notify", {
      connection: connection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 2000,
      },
    })
  }
  return notifyQueue
}

/**
 * BullMQ rejects custom job ids containing ":" ("Custom Id cannot contain :"),
 * which every dedupe key did — so every enqueue failed and no transactional
 * email or notification was ever delivered. Map keys to a safe id.
 */
export function toJobId(dedupeKey: string): string {
  return dedupeKey.replace(/:/g, "|")
}

/** Fire-and-forget email enqueue. Never throws (jobs must not break flows). */
export async function enqueueEmail(job: EmailJobData): Promise<void> {
  try {
    await getEmailQueue().add(job.template, job, { jobId: toJobId(job.dedupeKey) })
  } catch (err) {
    console.error("[jobs] email enqueue failed:", err)
  }
}

export async function enqueueNotification(job: NotifyJobData): Promise<void> {
  try {
    await getNotifyQueue().add("notify", job, { jobId: toJobId(job.dedupeKey) })
  } catch (err) {
    console.error("[jobs] notify enqueue failed:", err)
  }
}
