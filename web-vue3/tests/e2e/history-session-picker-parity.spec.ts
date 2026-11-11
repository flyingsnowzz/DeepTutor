import { expect, test } from '@playwright/test'

test('history session picker searches, previews, selects and submits history references', async ({ page }) => {
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
        ;(window as unknown as { __historyMessages: unknown[] }).__historyMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 'new', turn_id: 't1', seq: 1 }) }), 0)
      }
      emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __historyMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __historyMessages: unknown[] }).__historyMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/sessions/search') return route.fulfill({ json: { sessions: [{ session_id: 's1', id: 's1', title: 'Vector history', message_count: 3, updated_at: Date.now() / 1000, last_message: 'Embedding notes', match_excerpt: 'Embedding notes' }], total: 1 } })
    if (path === '/api/sessions/s1') return route.fulfill({ json: { id: 's1', session_id: 's1', title: 'Vector history', messages: [{ role: 'user', content: 'Explain embeddings' }, { role: 'assistant', content: 'Embeddings represent meaning.' }] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  await page.getByRole('button', { name: '资源', exact: true }).click()
  await page.getByRole('dialog', { name: '资源' }).getByRole('button', { name: '聊天历史', exact: true }).click()
  await page.waitForTimeout(500)
  const dialog = page.getByRole('dialog', { name: '选择对话记录' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('搜索对话、消息或结论').fill('Vector')
  const result = dialog.getByRole('button', { name: /Vector history/ })
  await expect(result).toBeVisible()
  await result.hover()
  await expect(dialog).toContainText('Embeddings represent meaning.')
  await result.click()
  await dialog.getByRole('button', { name: '添加到消息' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.selected-reference-chips')).toContainText('Vector history')

  const composer = page.locator('form.composer textarea')
  await composer.fill('Use that history')
  await page.screenshot({ path: '/tmp/history-before-send.png', fullPage: true })
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __historyMessages: unknown[] }).__historyMessages.length)).toBe(1)
  const sentPayload = await page.evaluate(() => (window as unknown as { __historyMessages: Array<Record<string, unknown>> }).__historyMessages)
  expect(sentPayload[0].history_references).toEqual(['s1'])
  expect(sentPayload[0].content).toBe('Use that history')
  await expect(page.locator('.selected-reference-chips')).toHaveCount(0)

  await page.getByRole('button', { name: '资源', exact: true }).click()
  await page.getByRole('dialog', { name: '资源' }).getByRole('button', { name: '聊天历史', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('搜索对话、消息或结论').fill('Vector')
  const persistentResult = dialog.getByRole('button', { name: /Vector history/ })
  await expect(persistentResult).toBeVisible()
  await persistentResult.click()
  await dialog.getByRole('checkbox', { name: '每轮都包含这些资源' }).check()
  await dialog.getByRole('button', { name: '添加到消息' }).click()
  await expect(page.locator('.selected-reference-chips')).toContainText('Vector history')
  await page.locator('form.composer textarea').fill('Use it every turn')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __historyMessages: unknown[] }).__historyMessages.length)).toBe(2)
  const persistentPayloads = await page.evaluate(() => (window as unknown as { __historyMessages: Array<Record<string, unknown>> }).__historyMessages)
  expect(persistentPayloads[1].history_references).toEqual(['s1'])
  await expect(page.locator('.selected-reference-chips')).toContainText('Vector history')
})
