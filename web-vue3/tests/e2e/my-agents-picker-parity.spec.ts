import { expect, test } from '@playwright/test'

test('my agents picker filters imported conversations, previews and adds history references', async ({ page }) => {
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
        ;(window as unknown as { __agentMessages: unknown[] }).__agentMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __agentMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __agentMessages: unknown[] }).__agentMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/imports/chat-history') return route.fulfill({ json: { sessions: [{ id: 'agent-session', session_id: 'agent-session', title: 'Refactor analysis', created_at: Date.now() / 1000, updated_at: Date.now() / 1000, message_count: 4, last_message: 'The module boundary is cleaner.', preferences: { import: { source: 'claude_code', source_cwd: '/Users/test/project' } } }] } })
    if (path === '/api/sessions/agent-session') return route.fulfill({ json: { messages: [{ role: 'user', content: 'Review this module' }, { role: 'assistant', content: 'The module boundary is cleaner.' }] } })
    if (path === '/api/personas') return route.fulfill({ json: { personas: [] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/skills/list') return route.fulfill({ json: { skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    if (path === '/api/question-notebook/categories' || path === '/api/question-notebook/materials') return route.fulfill({ json: [] })
    if (path === '/api/question-notebook/entries') return route.fulfill({ json: { items: [], total: 0 } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  await page.getByRole('button', { name: '资源', exact: true }).click()
  await page.getByRole('dialog', { name: '资源' }).getByRole('button', { name: '智能体历史对话', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '选择智能体会话' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Claude Code/ })).toBeVisible()
  await dialog.locator('.agents-group-heading').getByRole('button').last().click()
  const row = dialog.locator('.agents-row').filter({ hasText: 'Refactor analysis' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '预览' }).click()
  await expect(dialog.locator('.agents-preview')).toContainText('Review this module')
  await row.locator('.agents-row-select').click()
  await dialog.getByRole('button', { name: /使用所选/ }).click()
  await expect(page.locator('.selected-reference-chips')).toContainText('Refactor analysis')

  await page.locator('form.composer textarea').fill('Use that agent context')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __agentMessages: unknown[] }).__agentMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __agentMessages: Array<Record<string, unknown>> }).__agentMessages)
  expect(payloads[0].history_references).toEqual(['agent-session'])
  await expect(page.locator('.selected-reference-chips')).toHaveCount(0)
})
