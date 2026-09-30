/**
 * Minimal Node runner for TanStack Start's fetch-handler build output
 * (dist/server/server.js). Handles streaming responses and multiple
 * Set-Cookie headers. Node >= 20.
 */
import { createServer } from "node:http"
import handler from "./dist/server/server.js"

const port = Number(process.env.PORT) || 3000
const hostname = process.env.HOST || "0.0.0.0"
// Largest accepted request body (M14). Uploads are capped at 5 MB and CSV
// imports at 2 MB by the app; multipart framing needs some headroom.
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES) || 12 * 1024 * 1024

class PayloadTooLarge extends Error {}

function readBody(req) {
  const declared = Number(req.headers["content-length"] ?? 0)
  if (declared > maxBodyBytes) return Promise.reject(new PayloadTooLarge())
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", (c) => {
      size += c.length
      if (size > maxBodyBytes) {
        reject(new PayloadTooLarge())
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    )
    const body =
      req.method !== "GET" && req.method !== "HEAD"
        ? await readBody(req)
        : undefined

    const request = new Request(url, {
      method: req.method,
      headers: new Headers(req.headers),
      body,
      // @ts-expect-error node runtime supports duplex streams
      duplex: "half",
    })

    const response = await handler.fetch(request)

    const headers = new Headers(response.headers)
    headers.delete("content-length") // we re-chunk streamed bodies
    headers.delete("transfer-encoding")
    const setCookies = response.headers.getSetCookie?.() ?? []
    for (const c of setCookies) headers.append("set-cookie", c)

    res.writeHead(response.status, Object.fromEntries(headers))

    if (!response.body) {
      res.end()
      return
    }
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
    res.end()
  } catch (err) {
    if (err instanceof PayloadTooLarge) {
      if (!res.headersSent) res.writeHead(413, { connection: "close" })
      res.end("Payload Too Large")
      return
    }
    console.error("[server] request failed:", err)
    if (!res.headersSent) res.writeHead(500)
    res.end("Internal Server Error")
  }
})

server.listen(port, hostname, () => {
  console.log(`Server listening on http://${hostname}:${port}`)
})

// finish in-flight requests on container stop
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10_000).unref()
  })
}
