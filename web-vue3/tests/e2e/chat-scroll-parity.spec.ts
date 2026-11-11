import { expect, test } from '@playwright/test'

test('chat streaming preserves manual reading position and resumes following near the bottom', async ({ page }) => {
  const longAnswer = Array.from({ length: 45 }, (_, index) => `Paragraph ${index + 1}: a detailed explanation with enough content to make the transcript scroll.`).join('\n\n')
  await page.addInitScript(() => {
    class FakeWebSocket {
      static OPEN = 1
      readyState = 1
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { (window as unknown as { __scrollSocket: FakeWebSocket }).__scrollSocket = this }
      send(_raw: string) {}
      emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions/s1') return route.fulfill({ json: { id: 's1', title: 'Scroll', active_turn_id: 't1', status: 'running', messages: [{ id: 1, role: 'user', content: 'Explain' }, { id: 2, role: 'assistant', content: longAnswer }] } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [{ id: 's1', title: 'Scroll' }] } })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners' || path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat/s1')
  const root = page.locator('.message-list')
  await expect.poll(() => root.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect.poll(() => root.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 5)).toBe(true)
  await root.evaluate(element => { element.scrollTop = 0 })
  await root.hover()
  await page.mouse.wheel(0, -400)
  await expect.poll(() => root.evaluate(element => element.scrollTop)).toBe(0)
  await page.evaluate(() => {
    const socket = (window as unknown as { __scrollSocket: { emit: (value: unknown) => void } }).__scrollSocket
    socket.emit({ type: 'content', session_id: 's1', turn_id: 't1', seq: 1, content: '\n\nNew streamed paragraph.' })
  })
  await page.waitForTimeout(100)
  expect(await root.evaluate(element => element.scrollTop)).toBe(0)

  await root.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll', { bubbles: true })) })
  await page.evaluate(() => {
    const socket = (window as unknown as { __scrollSocket: { emit: (value: unknown) => void } }).__scrollSocket
    socket.emit({ type: 'content', session_id: 's1', turn_id: 't1', seq: 2, content: '\n\nAnother streamed paragraph.' })
  })
  await expect.poll(() => root.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 5)).toBe(true)
})
