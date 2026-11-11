import { expect, test } from '@playwright/test'

test('book reference picker selects exact chapter pages and sends book_references', async ({ page }) => {
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
        ;(window as unknown as { __bookMessages: unknown[] }).__bookMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __bookMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __bookMessages: unknown[] }).__bookMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/books') return route.fulfill({ json: { books: [{ id: 'b1', title: 'Calculus', description: 'Limits and derivatives', page_count: 2, chapter_count: 1 }], can_create: false } })
    if (path === '/api/books/b1') return route.fulfill({ json: { book: { id: 'b1', title: 'Calculus' }, spine: { chapters: [{ id: 'ch1', title: 'Limits', page_ids: ['p1', 'p2'] }] }, pages: [{ id: 'p1', title: 'Definition of a limit', chapter_id: 'ch1' }, { id: 'p2', title: 'Limit laws', chapter_id: 'ch1' }] } })
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
  await page.getByRole('dialog', { name: '资源' }).getByRole('button', { name: '书籍', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '选择书籍章节' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Calculus')
  await expect(dialog.locator('.book-page-row')).toHaveCount(2)
  await dialog.locator('.book-chapter > label input').check()
  await expect(dialog.locator('footer')).toContainText('已选择 2 个页面')
  await dialog.getByRole('button', { name: 'Limit laws', exact: true }).click()
  await expect(dialog.locator('footer')).toContainText('已选择 1 个页面')
  await dialog.getByRole('button', { name: '添加到消息' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.selected-reference-chips')).toContainText('Calculus（1）')

  await page.locator('form.composer textarea').fill('Use this book')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bookMessages: unknown[] }).__bookMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __bookMessages: Array<Record<string, unknown>> }).__bookMessages)
  expect(payloads[0].book_references).toEqual([{ book_id: 'b1', page_ids: ['p1'] }])
  await expect(page.locator('.selected-reference-chips')).toHaveCount(0)
})
