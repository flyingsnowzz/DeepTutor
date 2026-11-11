import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'

async function listeningServer(handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, port: server.address().port }
}

async function stop(server) {
  server.close()
  await once(server, 'close')
}

test('production server serves SPA routes and preserves backend callback/proxy policy', async () => {
  const seen = []
  const backend = await listeningServer((req, res) => {
    seen.push({ url: req.url, frontendHost: req.headers['x-deeptutor-frontend-host'], forwardedFor: req.headers['x-forwarded-for'] })
    if (req.url?.startsWith('/api/auth/openai-codex/callback')) {
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end('{"detail":"invalid state"}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"enabled":false}')
  })
  const frontend = await listeningServer(() => {})
  await stop(frontend.server) // Reserve-then-release a local test port.
  const child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, FRONTEND_HOST: '127.0.0.1', FRONTEND_PORT: String(frontend.port), DEEPTUTOR_API_ORIGIN: `http://127.0.0.1:${backend.port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await once(child.stdout, 'data')
    const base = `http://127.0.0.1:${frontend.port}`
    const deep = await fetch(`${base}/settings/learner-profile`)
    assert.equal(deep.status, 200)
    assert.match(await deep.text(), /<div id="app"><\/div>/)

    const callback = await fetch(`${base}/auth/callback?state=missing`)
    assert.equal(callback.status, 409)
    assert.deepEqual(await callback.json(), { detail: 'invalid state' })

    const retired = await fetch(`${base}/partners/groups`)
    assert.equal(retired.status, 404)

    const api = await fetch(`${base}/api/auth/status`, { headers: { 'x-forwarded-for': '203.0.113.9' } })
    assert.equal(api.status, 200)
    assert.equal(seen.at(-1).frontendHost, `127.0.0.1:${frontend.port}`)
    assert.equal(seen.at(-1).forwardedFor, undefined)
  } finally {
    child.kill('SIGTERM')
    await once(child, 'exit')
    await stop(backend.server)
  }
})
