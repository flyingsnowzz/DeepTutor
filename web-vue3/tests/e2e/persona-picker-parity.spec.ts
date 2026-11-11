import { expect, test } from '@playwright/test'

test('persona picker restores search, no-persona and persistent selection', async ({ page }) => {
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
        ;(window as unknown as { __personaMessages: unknown[] }).__personaMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __personaMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __personaMessages: unknown[] }).__personaMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/personas') return route.fulfill({ json: { personas: [{ name: 'Socratic tutor', description: 'Guides with questions' }, { name: 'Math coach', description: 'Explains equations clearly' }, { name: 'Writing coach', description: 'Improves essays' }, { name: 'Science guide', description: 'Explains experiments' }, { name: 'History tutor', description: 'Connects events' }, { name: 'Code mentor', description: 'Reviews code' }, { name: 'Language partner', description: 'Practices languages' }, { name: 'Exam coach', description: 'Prepares tests' }, { name: 'Reading guide', description: 'Builds comprehension' }] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/skills/list') return route.fulfill({ json: { skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [{ partner_id: 'research', name: 'Research partner', description: 'Finds sources' }] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    if (path === '/api/question-notebook/categories' || path === '/api/question-notebook/materials') return route.fulfill({ json: [] })
    if (path === '/api/question-notebook/entries') return route.fulfill({ json: { items: [], total: 0 } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  await page.locator('form.composer textarea').fill('/persona')
  await expect(page.getByRole('listbox', { name: '命令' }).getByRole('option', { name: /\/persona/ })).toBeVisible()
  await page.locator('form.composer textarea').press('Enter')
  const dialog = page.getByRole('dialog', { name: '偏好' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: '搜索回答风格与回答者' }).fill('questions')
  await dialog.getByRole('option', { name: /Socratic tutor/ }).click()
  await expect(page.locator('.selected-reference-chips')).toContainText('Socratic tutor')
  await page.locator('form.composer textarea').fill('/persona')
  await expect(page.getByRole('listbox', { name: '命令' }).getByRole('option', { name: /\/persona/ })).toBeVisible()
  await page.locator('form.composer textarea').press('Enter')
  await dialog.getByRole('textbox', { name: '搜索回答风格与回答者' }).fill('Research')
  await dialog.getByRole('option', { name: /Research partner/ }).click()
  await expect(page.getByRole('button', { name: /偏好/ })).toContainText('Research partner')

  await page.locator('form.composer textarea').fill('Teach me')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __personaMessages: unknown[] }).__personaMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __personaMessages: Array<Record<string, unknown>> }).__personaMessages)
  expect(payloads[0].persona).toBe('Socratic tutor')
  expect(payloads[0].answer_by).toBe('partner:research')
  await expect(page.locator('.selected-reference-chips')).toContainText('Socratic tutor')

  await page.locator('form.composer textarea').fill('/persona')
  await expect(page.getByRole('listbox', { name: '命令' }).getByRole('option', { name: /\/persona/ })).toBeVisible()
  await page.locator('form.composer textarea').press('Enter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('option', { name: /默认/ }).click()
  await expect(page.locator('.selected-reference-chips')).toHaveCount(0)
})
