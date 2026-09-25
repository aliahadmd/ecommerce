import { createFileRoute } from "@tanstack/react-router"
import { db, sql } from "@ecommerce/db"
import { getRedis } from "@ecommerce/redis"
import { getEnv } from "@ecommerce/config"
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3"

/**
 * Health check for Dokploy/uptime monitoring (plan-11 §3).
 * 200 = every dependency reachable; 503 with per-service detail otherwise.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const checks: Record<string, string> = {
          db: "fail",
          redis: "fail",
          storage: "fail",
        }

        const [dbRes, redisRes, storageRes] = await Promise.allSettled([
          db.execute(sql`select 1`),
          getRedis().ping(),
          new S3Client({
            endpoint: getEnv().S3_ENDPOINT,
            region: getEnv().S3_REGION,
            forcePathStyle: true,
            credentials: {
              accessKeyId: getEnv().S3_ACCESS_KEY,
              secretAccessKey: getEnv().S3_SECRET_KEY,
            },
          }).send(new HeadBucketCommand({ Bucket: getEnv().S3_BUCKET })),
        ])

        if (dbRes.status === "fulfilled") checks.db = "ok"
        if (redisRes.status === "fulfilled") checks.redis = "ok"
        if (storageRes.status === "fulfilled") checks.storage = "ok"

        const ok = Object.values(checks).every((v) => v === "ok")
        return Response.json(
          { status: ok ? "ok" : "fail", ...checks },
          { status: ok ? 200 : 503 },
        )
      },
    },
  },
})
