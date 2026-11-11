import { expect, test } from '@playwright/test'

test('main chat references exact reading sections and sends reading_references', async ({ page }) => {
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
        ;(window as unknown as { __readingPickerMessages: unknown[] }).__readingPickerMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __readingPickerMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __readingPickerMessages: unknown[] }).__readingPickerMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/personas') return route.fulfill({ json: { personas: [] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/skills/list') return route.fulfill({ json: { skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    if (path === '/api/settings') return route.fulfill({ json: { ui: { response_language: 'en', enabled_optional_tools: [] } } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    if (path === '/api/settings/llm-options') return route.fulfill({ json: { active: null, options: [] } })
    if (path === '/api/reading/materials') return route.fulfill({ json: [{
      material_id: 'abcdef12', filename: 'research.pdf', unit: 'page', unit_count: 3,
      title: 'Research Paper', revision: 2,
    }] })
    if (path === '/api/reading/materials/abcdef12') return route.fulfill({ json: {
      material_id: 'abcdef12', filename: 'research.pdf', unit: 'page', unit_count: 3,
      title: 'Research Paper', revision: 2,
      outline: [{ locator: 1, title: 'Introduction' }, { locator: 2, title: 'Method' }, { locator: 3, title: 'Results' }],
      unit_refs: [],
    } })
    if (path === '/api/imports/chat-history') return route.fulfill({ json: { sessions: [] } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  const composer = page.locator('form.composer textarea')
  await page.getByRole('button', { name: '资源', exact: true }).click()
  await page.getByRole('dialog', { name: '资源' }).getByRole('button', { name: '阅读', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '选择精读章节' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Research Paper/ })).toBeVisible()
  const units = dialog.locator('.reading-unit-list button')
  await expect(units).toHaveCount(3)
  await units.nth(0).click()
  await units.nth(2).click()
  await expect(dialog.locator('footer')).toContainText('已选 2 个精读章节')
  await dialog.getByRole('button', { name: '应用', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.selected-reference-chips')).toContainText('Research Paper（2）')

  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __readingPickerMessages: unknown[] }).__readingPickerMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __readingPickerMessages: Array<Record<string, unknown>> }).__readingPickerMessages)
  expect(payloads[0]).toMatchObject({
    type: 'start_turn',
    content: '',
    reading_references: [{ material_id: 'abcdef12', revision: 2, locators: [1, 3] }],
  })
})
