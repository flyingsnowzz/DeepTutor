import { expect, test } from '@playwright/test'

test('question picker filters the bank, selects visible rows and sends question references', async ({ page }) => {
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
        ;(window as unknown as { __questionMessages: unknown[] }).__questionMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __questionMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __questionMessages: unknown[] }).__questionMessages = []
  })
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (url.pathname === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (url.pathname === '/api/question-notebook/categories') return route.fulfill({ json: [{ id: 4, name: 'Calculus', entry_count: 2, created_at: 1 }] })
    if (url.pathname === '/api/question-notebook/materials') return route.fulfill({ json: [{ source: 'deep_question', material_id: 'm1', material_title: 'Limits quiz', entry_count: 2, unresolved_count: 1 }] })
    if (url.pathname === '/api/question-notebook/entries') {
      const wrongOnly = url.searchParams.get('is_correct') === 'false'
      return route.fulfill({ json: { items: wrongOnly ? [{ id: 2, question: 'What is a limit?', is_correct: false, user_answer: 'A value', difficulty: 'medium', question_type: 'short', material_title: 'Limits quiz' }] : [{ id: 1, question: 'What is a derivative?', is_correct: true, difficulty: 'easy', question_type: 'short', material_title: 'Limits quiz' }, { id: 2, question: 'What is a limit?', is_correct: false, user_answer: 'A value', difficulty: 'medium', question_type: 'short', material_title: 'Limits quiz' }], total: wrongOnly ? 1 : 2 } })
    }
    if (url.pathname === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (url.pathname === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (url.pathname === '/api/personas' || url.pathname === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (url.pathname === '/api/partners') return route.fulfill({ json: [] })
    if (url.pathname === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (url.pathname === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    if (url.pathname === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  await page.getByRole('button', { name: '资源', exact: true }).click()
  await page.getByRole('dialog', { name: '资源' }).getByRole('button', { name: '题库', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '选择题库题目' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.question-entry')).toHaveCount(2)
  await expect(dialog.getByRole('option', { name: /Calculus/ })).toBeAttached()
  await expect(dialog.getByRole('option', { name: /Limits quiz/ })).toBeAttached()
  await dialog.getByLabel('状态').selectOption('wrong')
  await expect(dialog.locator('.question-entry')).toHaveCount(1)
  await expect(dialog.locator('.question-entry')).toContainText('What is a limit?')
  await dialog.getByRole('button', { name: '全选当前结果' }).click()
  await expect(dialog.locator('footer')).toContainText('已选择 1 道题')
  await dialog.getByRole('button', { name: '添加到消息' }).click()
  await expect(page.locator('.selected-reference-chips')).toContainText('题库题目（1）')

  await page.locator('form.composer textarea').fill('Use this question')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __questionMessages: unknown[] }).__questionMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __questionMessages: Array<Record<string, unknown>> }).__questionMessages)
  expect(payloads[0].question_notebook_references).toEqual([2])
  await expect(page.locator('.selected-reference-chips')).toHaveCount(0)
})
