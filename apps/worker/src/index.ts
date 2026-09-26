import path from "node:path"
import dotenv from "dotenv"
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") })

import { Queue, Worker } from "bullmq"
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
  console.error(`[worker] email job ${job?.id} failed:`, err.message)
})
notifyWorker.on("failed", (job, err) => {
  console.error(`[worker] notify job ${job?.id} failed:`, err.message)
})

void Queue
console.log("[worker] running: email + notify queues")
