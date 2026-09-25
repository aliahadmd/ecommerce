/**
 * Minimal Node runner for TanStack Start's fetch-handler build output
 * (dist/server/server.js). Handles streaming responses and multiple
 * Set-Cookie headers. Node >= 20.
 */
import { createServer } from "node:http"
import handler from "./dist/server/server.js"

const port = Number(process.env.PORT) || 3000
const hostname = process.env.HOST || "0.0.0.0"

const server = createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    )
    const body =
      req.method !== "GET" && req.method !== "HEAD"
        ? await new Promise((resolve, reject) => {
            const chunks = []
            req.on("data", (c) => chunks.push(c))
            req.on("end", () => resolve(Buffer.concat(chunks)))
            req.on("error", reject)
          })
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
    console.error("[server] request failed:", err)
    if (!res.headersSent) res.writeHead(500)
    res.end("Internal Server Error")
  }
})

server.listen(port, hostname, () => {
  console.log(`Server listening on http://${hostname}:${port}`)
})
