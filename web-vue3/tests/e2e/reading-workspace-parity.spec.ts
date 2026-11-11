import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

test('reading workspace keeps the legacy document and companion layout with selection context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await allowWithoutAuth(page)
  await page.addInitScript(() => {
    const messages: Record<string, unknown>[] = []
    ;(window as unknown as { __readerMessages: typeof messages }).__readerMessages = messages
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) { messages.push(JSON.parse(raw) as Record<string, unknown>) }
      close() { this.readyState = 3; this.onclose?.() }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
  })
  await page.route('**/api/reading/workspaces/w1?*', route => route.fulfill({ json: { workspace: { workspace_id: 'w1', title: 'Guide collection', active_material_id: 'm1', tabs: [{ material: { material_id: 'm1', title: 'Guide', filename: 'guide.html', render_mode: 'html', status: 'ready', revision: 3 } }] }, sessions: [] } }))
  await page.route('**/api/reading/materials/m1/render?*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><h1>Guide</h1><p>A selected reading passage for tutor testing.</p></body></html>' }))
  await page.route('**/api/reading/materials/m1?*', route => route.fulfill({ json: { material_id: 'm1', title: 'Guide', render_mode: 'html', status: 'ready', revision: 3 } }))
  await page.route('**/api/reading/extensions?*', route => route.fulfill({ json: [] }))
  await page.goto('/learning/reading/w1/sessions')
  await expect(page.locator('.reading-workspace-bar')).toContainText('沉浸式阅读')
  await expect(page.locator('.reading-companion-welcome')).toContainText('边读边问')
  await expect(page.locator('.reading-document').boundingBox()).resolves.toMatchObject({ width: 786 })
  await expect(page.locator('.reading-chat').boundingBox()).resolves.toMatchObject({ width: 382 })
  await page.getByRole('button', { name: '展开目录' }).click()
  await expect(page.locator('.reading-navigator')).toBeVisible()
  await expect(page.locator('.reading-document').boundingBox()).resolves.toMatchObject({ width: 556 })
  await page.getByRole('button', { name: '收起目录' }).first().click()
  const passage = page.frameLocator('iframe').locator('p')
  await passage.selectText()
  await passage.click()
  await expect(page.locator('.reading-selection')).toContainText('A selected reading passage')
  await page.getByPlaceholder('就这份资料提问…').fill('Explain this')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __readerMessages: Record<string, unknown>[] }).__readerMessages.length)).toBeGreaterThan(0)
  const messages = await page.evaluate(() => (window as unknown as { __readerMessages: Record<string, unknown>[] }).__readerMessages)
  const start = messages.find(message => message.type === 'start_turn')
  expect(start?.reading_material_id).toBe('m1')
  expect(start?.reading_material_revision).toBe(3)
  expect(start?.reading_viewport).toEqual({ locator: 1, selection: 'A selected reading passage for tutor testing.' })
})
