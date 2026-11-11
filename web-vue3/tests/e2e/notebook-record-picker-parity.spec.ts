import { expect, test } from '@playwright/test'

test('notebook record picker selects individual records and groups notebook references', async ({ page }) => {
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
        ;(window as unknown as { __notebookMessages: unknown[] }).__notebookMessages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __notebookMessages: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __notebookMessages: unknown[] }).__notebookMessages = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [{ id: 'n1', name: 'Calculus notes', record_count: 2 }, { id: 'n2', name: 'Review notes', record_count: 1 }] } })
    if (path === '/api/notebooks/n1') return route.fulfill({ json: { records: [{ id: 'r1', title: 'Limits summary', summary: 'Limit definition', type: 'chat' }, { id: 'r2', title: 'Derivative summary', summary: 'Derivative rules', type: 'research' }] } })
    if (path === '/api/notebooks/n2') return route.fulfill({ json: { records: [{ id: 'r3', title: 'Review mistakes', summary: 'Common errors', type: 'question' }] } })
    if (path === '/api/question-notebook/categories') return route.fulfill({ json: [] })
    if (path === '/api/question-notebook/materials') return route.fulfill({ json: [] })
    if (path === '/api/question-notebook/entries') return route.fulfill({ json: { items: [], total: 0 } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 1000, max_total_bytes: 2000 } } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  await page.getByRole('button', { name: '资源', exact: true }).click()
  await page.getByRole('dialog', { name: '资源' }).getByRole('button', { name: '收藏夹', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '选择收藏记录' })
  await expect(dialog).toBeVisible()
  const calculus = dialog.locator('.notebook-picker-group').filter({ hasText: 'Calculus notes' })
  await calculus.getByRole('button', { name: /Calculus notes/ }).click()
  await expect(calculus.getByRole('button', { name: 'Limits summary' })).toBeVisible()
  await calculus.getByRole('button', { name: '全选', exact: true }).click()
  const review = dialog.locator('.notebook-picker-group').filter({ hasText: 'Review notes' })
  await review.getByRole('button', { name: /Review notes/ }).click()
  await review.getByRole('button', { name: 'Review mistakes' }).click()
  await expect(dialog.locator('footer')).toContainText('已选择 3 条记录')
  await dialog.getByRole('button', { name: /使用所选记录/ }).click()
  await expect(page.locator('.selected-reference-chips')).toContainText('2 项引用')
  await page.locator('.context-reference-summary').click()
  await expect(page.locator('.selected-reference-chips')).toContainText('Calculus notes（2）')
  await expect(page.locator('.selected-reference-chips')).toContainText('Review notes（1）')

  await page.locator('form.composer textarea').fill('Use these favorites')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __notebookMessages: unknown[] }).__notebookMessages.length)).toBe(1)
  const payloads = await page.evaluate(() => (window as unknown as { __notebookMessages: Array<Record<string, unknown>> }).__notebookMessages)
  expect(payloads[0].notebook_references).toEqual([{ notebook_id: 'n1', record_ids: ['r1', 'r2'] }, { notebook_id: 'n2', record_ids: ['r3'] }])
  await expect(page.locator('.selected-reference-chips')).toHaveCount(0)
})
