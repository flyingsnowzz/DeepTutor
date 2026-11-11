import { expect, test } from '@playwright/test'

test('composer resources match the React list, search, knowledge and task flows', async ({ page }) => {
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
        ;(window as unknown as { __resourceMessages: unknown[] }).__resourceMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __resourceMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __resourceMessages: unknown[] }).__resourceMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [{ id: 'kb1', name: 'Library' }] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    if (path === '/api/task-board') return route.fulfill({ json: { cards: [{ id: 'task1', title: 'Review vectors', note: '', status: 'todo', archived: false }], colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [] } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  await page.getByRole('button', { name: '资源', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '资源' })
  await expect(dialog).toBeVisible()
  for (const label of ['上传附件', '聊天历史', '智能体历史对话', '书籍', '阅读', '收藏夹', '题库', '关联任务', '知识库']) {
    await expect(dialog.getByRole('button', { name: new RegExp(label) })).toBeVisible()
  }

  const search = dialog.getByRole('textbox', { name: '搜索资源入口' })
  await search.fill('阅读')
  await expect(dialog.getByRole('button', { name: /阅读/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /题库/ })).toHaveCount(0)
  await search.fill('')

  await dialog.getByRole('button', { name: /知识库/ }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Library' })).toBeVisible()
  await dialog.getByRole('button', { name: '返回' }).click()
  await dialog.getByRole('button', { name: /关联任务/ }).click()
  await expect(dialog.getByRole('checkbox', { name: /Review vectors/ })).toBeVisible()
  await dialog.getByRole('checkbox', { name: /Review vectors/ }).check()
  await dialog.getByRole('button', { name: '关闭' }).click()

  await page.locator('form.composer textarea').fill('Link this task')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __resourceMessages: unknown[] }).__resourceMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __resourceMessages: Array<Record<string, unknown>> }).__resourceMessages)
  expect(payloads[0].config).toMatchObject({
    linked_task_ids: ['task1'],
    _resource_reuse: expect.objectContaining({
      knowledge: true,
      persona: true,
      skills: true,
      mcp: true,
    }),
  })
})
