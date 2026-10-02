/**
 * Minimal Node runner for TanStack Start's fetch-handler build output
 * (dist/server/server.js). Handles streaming responses and multiple
 * Set-Cookie headers. Node >= 20.
 */
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import handler from "./dist/server/server.js"

// The Start fetch handler renders pages and server functions only; the built
// client files (JS/CSS/fonts/public/) are served from dist/client here.
const CLIENT_DIR = fileURLToPath(new URL("./dist/client/", import.meta.url))
const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
}

/** Serve a file from dist/client if the path names one; false otherwise. */
async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return false
  }
  const file = normalize(join(CLIENT_DIR, decoded))
  if (!file.startsWith(CLIENT_DIR) || file.endsWith(sep)) return false // no traversal
  let info
  try {
    info = await stat(file)
  } catch {
    return false
  }
  if (!info.isFile()) return false
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    // hashed build assets never change; public/ files may
    "cache-control": decoded.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
  })
  if (req.method === "HEAD") res.end()
  else createReadStream(file).pipe(res)
  return true
}

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
    if (await serveStatic(req, res, url.pathname)) return
    // A missing hashed asset (e.g. from a previous build) must not be cached
    // as a 404 by browsers or the CDN — the next deploy may need that URL.
    if (url.pathname.startsWith("/assets/")) {
      res.writeHead(404, { "cache-control": "no-store", "content-type": "text/plain" })
      res.end("Not Found")
      return
    }
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
