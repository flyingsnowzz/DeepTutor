import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const dist = resolve(root, 'dist')
const backend = new URL(process.env.DEEPTUTOR_API_ORIGIN || process.env.DEEPTUTOR_API_BASE_URL || 'http://127.0.0.1:8001')
const port = Number(process.env.FRONTEND_PORT || 3782)
const host = process.env.FRONTEND_HOST || '0.0.0.0'
const types = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
}

function proxyHeaders(req, websocket = false) {
  const headers = { ...req.headers }
  const connectionTokens = String(headers.connection || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  for (const name of [
    'connection', 'upgrade', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto',
    'x-forwarded-for', 'x-forwarded-port', 'x-forwarded-server', 'x-real-ip',
    'x-client-ip', 'x-host', 'x-original-host', 'x-deeptutor-frontend-host',
    ...connectionTokens,
  ]) delete headers[name]
  if (websocket) {
    headers.connection = 'Upgrade'
    headers.upgrade = 'websocket'
  }
  headers.host = backend.host
  headers.origin = backend.origin
  headers['x-deeptutor-frontend-host'] = req.headers.host || ''
  return headers
}
function proxy(req, res, targetPath = req.url) {
  const transport = backend.protocol === 'https:' ? httpsRequest : request
  const upstream = transport({
    protocol: backend.protocol,
    hostname: backend.hostname,
    port: backend.port || (backend.protocol === 'https:' ? 443 : 80),
    path: targetPath,
    method: req.method,
    headers: proxyHeaders(req),
  }, upstreamResponse => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
    upstreamResponse.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Backend unavailable')
  })
  req.pipe(upstream)
}

async function serveStatic(req, res) {
  let pathname
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname) }
  catch { res.writeHead(400); res.end('Bad request'); return }
  const candidate = resolve(dist, `.${pathname}`)
  if (candidate !== dist && !candidate.startsWith(`${dist}${sep}`)) {
    res.writeHead(403); res.end('Forbidden'); return
  }
  let file = candidate
  let info = await stat(file).catch(() => null)
  if (!info?.isFile()) {
    file = resolve(dist, 'index.html')
    info = await stat(file).catch(() => null)
  }
  if (!info?.isFile()) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Vue frontend has not been built. Run npm run build in web-vue3.')
    return
  }
  const extension = extname(file)
  const headers = {
    'content-type': types[extension] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'accept-ranges': 'bytes',
  }
  let start = 0
  let end = info.size - 1
  let status = 200
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  if (range && info.size > 0) {
    if (range[1]) start = Number(range[1])
    if (range[2]) end = Math.min(Number(range[2]), end)
    if (!range[1] && range[2]) start = Math.max(0, info.size - Number(range[2]))
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= info.size) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` }); res.end(); return
    }
    status = 206
    headers['content-range'] = `bytes ${start}-${end}/${info.size}`
  }
  headers['content-length'] = String(Math.max(0, end - start + 1))
  res.writeHead(status, headers)
  if (req.method === 'HEAD' || info.size === 0) { res.end(); return }
  const stream = createReadStream(file, { start, end })
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

const server = createServer((req, res) => {
  const path = req.url || '/'
  const pathname = new URL(path, 'http://localhost').pathname
  if (pathname === '/partners/groups') { res.writeHead(404); res.end('Not found'); return }
  if (pathname === '/auth/callback') {
    proxy(req, res, `/api/auth/openai-codex/callback${new URL(path, 'http://localhost').search}`)
    return
  }
  if (path.startsWith('/api/') || path === '/api' || path.startsWith('/files/') || path === '/files') {
    proxy(req, res)
    return
  }
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return
  }
  void serveStatic(req, res)
})

server.on('upgrade', (req, client, head) => {
  if (!(req.url === '/ws' || req.url?.startsWith('/ws/') || req.url?.startsWith('/ws?'))) { client.destroy(); return }
  const transport = backend.protocol === 'https:' ? httpsRequest : request
  const upstream = transport({
    protocol: backend.protocol,
    hostname: backend.hostname,
    port: backend.port || (backend.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: 'GET',
    headers: proxyHeaders(req, true),
  })
  upstream.on('upgrade', (response, socket, upgradeHead) => {
    client.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
    if (upgradeHead.length) client.write(upgradeHead)
    if (head.length) socket.write(head)
    socket.pipe(client).pipe(socket)
  })
  upstream.on('response', response => {
    client.write(`HTTP/1.1 ${response.statusCode || 502} Bad Gateway\r\n\r\n`)
    client.destroy()
  })
  upstream.on('error', () => client.destroy())
  upstream.end()
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
server.listen(port, host, () => {
  console.log(`DeepTutor Vue 3 frontend listening on http://${host}:${port}; backend ${backend.origin}`)
})
