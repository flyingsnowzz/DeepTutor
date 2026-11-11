import { expect, test } from '@playwright/test'

test('reading actions link conversations, send history references and export notes', async ({ page }) => {
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
  const sessions = [
    { workspace_id: 'w1', session_id: 's1', title: 'Main reading', active_material_id: 'm1', linked_session_ids: [] },
    { workspace_id: 'w1', session_id: 's2', title: 'Earlier reading', active_material_id: 'm1', linked_session_ids: [] },
  ]
  let linkedBody: Record<string, unknown> | null = null
  let notebookBody: Record<string, unknown> | null = null
  const workspace = { workspace_id: 'w1', title: 'Collection', active_material_id: 'm1', tabs: [{ material: { material_id: 'm1', title: 'Guide', filename: 'guide.html', render_mode: 'html', status: 'ready', revision: 1 } }] }

  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/reading/workspaces/w1?*', route => route.fulfill({ json: { workspace, sessions } }))
  await page.route('**/api/reading/workspaces/w1/sessions?*', route => route.fulfill({ json: { sessions } }))
  await page.route('**/api/reading/workspaces/w1/sessions/s1/links?*', async route => {
    linkedBody = route.request().postDataJSON() as Record<string, unknown>
    sessions[0].linked_session_ids = ['s2']
    return route.fulfill({ json: { linked_session_ids: ['s2'] } })
  })
  await page.route('**/api/reading/workspaces/w1/notebook?*', async route => {
    notebookBody = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ json: {} })
  })
  await page.route('**/api/reading/workspaces/w1/notes/organize?*', route => route.fulfill({ json: { notes: { workspace_id: 'w1', title: 'Collection', markdown: '# Organized notes', material_ids: ['m1'], annotation_count: 1 } } }))
  await page.route('**/api/reading/materials/m1/render?*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><p>A selected reading passage</p></body></html>' }))
  await page.route('**/api/reading/materials/m1?*', route => route.fulfill({ json: { material_id: 'm1', title: 'Guide', render_mode: 'html', status: 'ready', revision: 1 } }))
  await page.route('**/api/reading/extensions?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [{ id: 'n1', name: 'Sources', record_count: 2 }] } }))
  await page.route('**/api/sessions/s1?*', route => route.fulfill({ json: { id: 's1', title: 'Main reading', messages: [] } }))

  await page.goto('/learning/reading/w1/sessions/s1')
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '关联阅读对话' }).click()
  const linkDialog = page.getByRole('dialog', { name: '关联阅读对话' })
  await expect(linkDialog).toBeVisible()
  await linkDialog.getByRole('button', { name: 'Earlier reading' }).click()
  await linkDialog.getByRole('button', { name: '保存关联' }).click()
  expect(linkedBody).toEqual({ target_session_id: 's2' })
  await expect(linkDialog).toHaveCount(0)

  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '发送到收藏夹' }).click()
  const notebookDialog = page.getByRole('dialog', { name: '发送阅读笔记到收藏夹' })
  await notebookDialog.getByRole('button', { name: /Sources/ }).click()
  await notebookDialog.getByRole('button', { name: '发送到收藏夹', exact: true }).click()
  expect(notebookBody).toEqual({ notebook_ids: ['n1'], material_ids: [] })

  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '整理笔记' }).click()
  await expect(page.getByRole('dialog', { name: '整理后的阅读笔记' })).toContainText('# Organized notes')
  await page.getByRole('dialog', { name: '整理后的阅读笔记' }).getByRole('button', { name: '关闭' }).click()

  await page.getByPlaceholder('就这份资料提问…').fill('Use the earlier conversation')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __readerMessages: Record<string, unknown>[] }).__readerMessages.find(message => message.type === 'start_turn')?.history_references)).toEqual(['s2'])
})
