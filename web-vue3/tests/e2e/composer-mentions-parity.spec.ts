import { expect, test } from '@playwright/test'

test('main-chat @ selects connected agents instead of opening a resource menu', async ({ page }) => {
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
        ;(window as unknown as { __agentMentionMessages: unknown[] }).__agentMentionMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __agentMentionMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __agentMentionMessages: unknown[] }).__agentMentionMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/personas') return route.fulfill({ json: { personas: [] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [
      { name: 'Researcher', metadata: { type: 'subagent', agent_kind: 'codex' } },
      { name: 'Writer', metadata: { type: 'subagent', agent_kind: 'claude_code' } },
    ] })
    if (path === '/api/skills/list') return route.fulfill({ json: { skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    if (path === '/api/settings') return route.fulfill({ json: { ui: { response_language: 'en', enabled_optional_tools: [] } } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    if (path === '/api/settings/llm-options') return route.fulfill({ json: { active: null, options: [] } })
    if (path === '/api/reading/materials') return route.fulfill({ json: [] })
    if (path === '/api/imports/chat-history') return route.fulfill({ json: { sessions: [] } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  const composer = page.locator('form.composer textarea')
  const agents = page.getByRole('listbox', { name: '与智能体对话' })

  await composer.fill('@')
  await expect(agents).toBeVisible()
  await expect(agents.getByRole('option')).toHaveCount(2)
  await expect(agents.getByRole('option', { name: 'Researcher' })).toBeVisible()
  await expect(agents.getByRole('option', { name: 'Writer' })).toBeVisible()
  await expect(page.getByRole('listbox', { name: '引用空间' })).toHaveCount(0)

  await composer.fill('@wri')
  await expect(agents.getByRole('option')).toHaveCount(1)
  await composer.press('Enter')
  await expect(agents).toBeHidden()
  await expect(composer).toHaveValue('')

  await composer.fill('@missing')
  await expect(agents).toContainText('没有匹配的智能体')
  await composer.press('Escape')
  await expect(agents).toBeHidden()

  await composer.fill('Ask Writer')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __agentMentionMessages: unknown[] }).__agentMentionMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __agentMentionMessages: Array<Record<string, unknown>> }).__agentMentionMessages)
  expect(payloads[0].knowledge_bases).toEqual(['Writer'])
})
