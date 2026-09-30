import { writeFileSync } from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
// repo-root .env (apps/worker/src → ../../../.env); a no-op in containers,
// where the environment is injected
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") })

import { Worker } from "bullmq"
import { getEnv } from "@ecommerce/config"
import { handleEmailJob, handleNotifyJob } from "@ecommerce/jobs"

const connection = { url: getEnv().REDIS_URL }

const emailWorker = new Worker("email", async (job) => handleEmailJob(job.data), {
  connection,
  concurrency: 4,
})
const notifyWorker = new Worker("notify", async (job) => handleNotifyJob(job.data), {
  connection,
  concurrency: 4,
})

emailWorker.on("failed", (job, err) => {
  console.error(`[worker] email job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
})
notifyWorker.on("failed", (job, err) => {
  console.error(`[worker] notify job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
})

// Liveness for container healthchecks: the worker serves no HTTP, so it
// touches a heartbeat file while its Redis connections are usable.
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/worker-heartbeat"
const heartbeat = setInterval(() => {
  if (emailWorker.isRunning() && notifyWorker.isRunning()) {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()))
  }
}, 15_000)

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received — draining`)
  clearInterval(heartbeat)
  await Promise.allSettled([emailWorker.close(), notifyWorker.close()])
  process.exit(0)
}
process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))

console.log("[worker] running: email + notify queues")
