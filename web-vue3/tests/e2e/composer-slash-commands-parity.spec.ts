import { expect, test } from '@playwright/test'

test('composer slash commands match the legacy persona and reply-language flows', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) {
        const value = JSON.parse(raw)
        ;(window as unknown as { __slashMessages: unknown[] }).__slashMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __slashMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __slashMessages: unknown[] }).__slashMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/personas') return route.fulfill({ json: { personas: [{ name: 'Socratic tutor', description: 'Guides with questions' }] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/skills/list') return route.fulfill({ json: { skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    if (path === '/api/settings') return route.fulfill({ json: { ui: { response_language: 'en', enabled_optional_tools: [] } } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    if (path === '/api/settings/llm-options') return route.fulfill({ json: { active: null, options: [] } })
    if (path === '/api/question-notebook/categories' || path === '/api/question-notebook/materials') return route.fulfill({ json: [] })
    if (path === '/api/question-notebook/entries') return route.fulfill({ json: { items: [], total: 0 } })
    if (path === '/api/imports/chat-history') return route.fulfill({ json: { sessions: [] } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  const composer = page.locator('form.composer textarea')
  const commands = page.getByRole('listbox', { name: '命令' })

  await composer.fill('/')
  await expect(commands).toBeVisible()
  await expect(commands.getByRole('option')).toHaveCount(2)
  await expect(commands.getByRole('option', { name: /\/persona/ })).toBeVisible()
  await expect(commands.getByRole('option', { name: /\/language/ })).toBeVisible()

  await composer.fill('/per')
  await expect(commands.getByRole('option')).toHaveCount(1)
  await composer.press('Enter')
  await expect(page.getByRole('dialog', { name: '偏好' })).toBeVisible()
  await expect(composer).toHaveValue('')
  await page.getByRole('dialog', { name: '偏好' }).getByRole('option', { name: /默认/ }).click()

  await composer.fill('/')
  await composer.press('ArrowDown')
  await composer.press('Enter')
  const languages = page.getByRole('listbox', { name: '回复语言' })
  await expect(languages).toBeVisible()
  await expect(languages.getByRole('option')).toHaveCount(16)
  await expect(languages.getByRole('option', { name: '账户默认 (English)' })).toHaveAttribute('aria-selected', 'true')
  await languages.getByRole('option', { name: 'Français' }).click()
  await expect(languages).toBeHidden()

  await composer.fill('/language')
  await composer.press('Enter')
  await expect(languages).toBeVisible()
  await composer.press('Escape')
  await expect(languages).toBeHidden()

  await composer.fill('/')
  await composer.press('Escape')
  await expect(commands).toBeHidden()
  await expect(composer).toHaveValue('/')

  await composer.fill('Bonjour')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __slashMessages: unknown[] }).__slashMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __slashMessages: Array<Record<string, unknown>> }).__slashMessages)
  expect(payloads[0]).toMatchObject({ type: 'start_turn', content: 'Bonjour', language: 'fr', reply_language_override: 'fr' })
})
