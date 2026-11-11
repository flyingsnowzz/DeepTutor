import { expect, test } from '@playwright/test'

test('voice settings restore playback toggles and persist each preference independently', async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = []
  const settings = { ui: { voice_autoplay: false, voice_math_speak: true } }
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } })
    if (path === '/api/settings/voice-autoplay' || path === '/api/settings/voice-math-speak') {
      const body = request.postDataJSON()
      writes.push({ path, body })
      if ('voice_autoplay' in body) settings.ui.voice_autoplay = body.voice_autoplay
      if ('voice_math_speak' in body) settings.ui.voice_math_speak = body.voice_math_speak
      return route.fulfill({ json: body })
    }
    if (path === '/api/settings') return route.fulfill({ json: settings })
    return route.fulfill({ json: {} })
  })
  await page.goto('/settings/voice')
  const autoplay = page.getByRole('switch', { name: '自动播放回复', exact: true })
  const mathSpeak = page.getByRole('switch', { name: '数学朗读', exact: true })
  await expect(autoplay).toHaveAttribute('aria-checked', 'false')
  await expect(mathSpeak).toHaveAttribute('aria-checked', 'true')
  await autoplay.click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toEqual({ path: '/api/settings/voice-autoplay', body: { voice_autoplay: true } })
  await expect(autoplay).toHaveAttribute('aria-checked', 'true')
  await mathSpeak.click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toEqual({ path: '/api/settings/voice-math-speak', body: { voice_math_speak: false } })
  await expect(mathSpeak).toHaveAttribute('aria-checked', 'false')
})

test('autoplay runs only for a freshly completed reply and never for loaded history', async ({ page }) => {
  const ttsBodies: unknown[] = []
  let replied = false
  let sessionLoads = 0
  await page.addInitScript(() => {
    class FakeAudio {
      src = ''; onended: (() => void) | null = null; onerror: (() => void) | null = null
      load() {}
      play() { const plays = (window as unknown as { __audioPlays: string[] }).__audioPlays; plays.push(this.src); return Promise.resolve() }
      pause() {}
    }
    ;(window as unknown as { __audioPlays: string[] }).__audioPlays = []
    ;(window as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) {
        const value = JSON.parse(raw) as { type?: string }
        if (value.type === 'start_turn') setTimeout(() => { this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }) }, 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/settings') return route.fulfill({ json: { ui: { voice_autoplay: true, voice_math_speak: true } } })
    if (path === '/api/voice/tts') { ttsBodies.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'audio/mpeg', body: 'audio' }) }
    if (path === '/api/sessions/s1') { sessionLoads += 1; replied = sessionLoads > 1; return route.fulfill({ json: { id: 's1', title: 'Voice', messages: replied ? [{ id: 1, role: 'user', content: 'Hello', parent_message_id: null }, { id: 2, role: 'assistant', content: 'Fresh answer', parent_message_id: 1 }] : [{ id: 1, role: 'user', content: 'Hello', parent_message_id: null }] } }) }
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [{ id: 's1', title: 'Voice' }] } })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners' || path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat/s1')
  await expect(page.locator('[data-chat-message-id="1"]')).toBeVisible()
  await page.waitForTimeout(150)
  expect(ttsBodies).toEqual([])
  await page.locator('textarea').fill('Continue')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => ttsBodies.length).toBe(1)
  expect(ttsBodies[0]).toEqual({ text: 'Fresh answer' })
  await expect(page.locator('[data-chat-message-id="2"]')).toContainText('Fresh answer')
  await expect(page.getByRole('button', { name: '停止朗读', exact: true })).toBeVisible()
})
