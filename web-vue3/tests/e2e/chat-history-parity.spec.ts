import { expect, test } from '@playwright/test'

test('chat history uses the legacy page bar, filters and row action menu', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/task-board*', route => route.fulfill({ json: { cards: [], colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [] } }))
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [{ id: 's1', session_id: 's1', title: 'Study', updated_at: 10, preferences: {} }] } }))
  await page.route('**/api/sessions/s1/organization?*', route => route.fulfill({ json: {} }))
  await page.goto('/space/chat-history')
  await expect(page.locator('.history-page-bar')).toContainText('1 个对话')
  await expect(page.locator('.history-page-content > .history-header')).toHaveCSS('position', 'absolute')
  await expect(page.locator('.history-controls')).toHaveCSS('display', 'block')
  await expect(page.getByPlaceholder('搜索历史对话...')).toBeVisible()
  await expect(page.locator('.history-list')).toHaveCSS('border-top-width', '0px')
  await expect(page.locator('.history-list')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.history-row').first()).toHaveCSS('padding', '6px 4px 6px 6px')
  await expect(page.locator('.history-row').first()).toHaveCSS('min-height', '33px')
  await expect(page.locator('.history-controls input')).toHaveCSS('border-top-width', '0px')
  await expect(page.locator('.history-controls input')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.history-title strong').first()).toHaveCSS('font-size', '12.5px')
  await expect(page.locator('.history-actions-trigger')).toHaveCSS('width', '21px')
  await expect(page.locator('.history-actions-trigger')).toHaveCSS('height', '21px')
  const rowBox = await page.locator('.history-row').first().boundingBox()
  expect(rowBox?.height).toBe(33)
  await expect(page.getByLabel('按聊天类型筛选').locator('option').nth(1)).toHaveText('主聊天')
  await expect(page.getByLabel('按聊天类型筛选').locator('option').nth(2)).toHaveText('小老师追问')
  await expect(page.getByLabel('按归档状态筛选').locator('option').first()).toHaveText('已激活')
  await page.getByRole('button', { name: '聊天操作', exact: true }).click()
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['重命名对话', '置顶', '归档', '删除对话'])
  await page.getByRole('menuitem', { name: '置顶' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
})


test('chat history row actions persist through the backend', async ({ page }) => {
  let sessions = [{ id: 's1', session_id: 's1', title: 'Study', updated_at: 10, preferences: {} }] as Array<any>
  const patches: Array<{ path: string; body: any }> = []
  const deletes: string[] = []
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/task-board*', route => route.fulfill({ json: { cards: [], colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [] } }))
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions } }))
  await page.route('**/api/sessions/s1/organization?*', async route => {
    const body = route.request().postDataJSON()
    patches.push({ path: '/organization', body })
    sessions = sessions.map(row => ({ ...row, preferences: { ...row.preferences, ...body } }))
    await route.fulfill({ json: { session: sessions[0] } })
  })
  await page.route(url => url.pathname === '/api/sessions/s1', async route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      patches.push({ path: '', body })
      sessions = sessions.map(row => ({ ...row, ...body }))
      await route.fulfill({ json: { session: sessions[0] } })
      return
    }
    if (route.request().method() === 'DELETE') {
      deletes.push(route.request().url())
      sessions = []
      await route.fulfill({ json: {} })
      return
    }
    await route.continue()
  })
  await page.goto('/space/chat-history')

  await page.getByRole('button', { name: '聊天操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '置顶' }).click()
  await expect.poll(() => patches).toContainEqual({ path: '/organization', body: { pinned: true } })
  await expect(page.locator('.history-pin')).toBeVisible()

  await page.getByRole('button', { name: '聊天操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '重命名对话' }).click()
  const titleInput = page.getByLabel('会话标题')
  await expect(titleInput).toHaveValue('Study')
  await titleInput.fill('Renamed')
  await titleInput.press('Enter')
  await expect.poll(() => patches).toContainEqual({ path: '', body: { title: 'Renamed' } })
  await expect(page.locator('.history-title strong')).toHaveText('Renamed')

  await page.getByRole('button', { name: '聊天操作', exact: true }).click()
  let confirmationMessage = ''
  page.once('dialog', async dialog => {
    confirmationMessage = dialog.message()
    await dialog.accept()
  })
  await page.getByRole('menuitem', { name: '删除对话' }).click()
  expect(confirmationMessage).toBe('永久删除此对话及其导师子对话？此操作无法撤销。')
  await expect.poll(() => deletes).toHaveLength(1)
  await expect(page.locator('.history-row')).toHaveCount(0)
  await expect(page.locator('.history-empty')).toContainText('没有匹配的会话')
})

test('chat history menu stays visible from the last row', async ({ page }) => {
  const sessions = Array.from({ length: 20 }, (_, index) => ({
    id: `s${index + 1}`,
    session_id: `s${index + 1}`,
    title: `Conversation ${index + 1}`,
    updated_at: 100 - index,
    preferences: {},
  }))
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/task-board*', route => route.fulfill({ json: { cards: [], colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [] } }))
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions } }))
  await page.goto('/space/chat-history')
  const lastRow = page.locator('.history-row').last()
  await lastRow.scrollIntoViewIfNeeded()
  await lastRow.getByRole('button', { name: '聊天操作', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  const viewport = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
})


test('chat history localizes the new-chat sentinel and carries the task color', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [{ id: 's1', session_id: 's1', title: 'New conversation', updated_at: 10, preferences: {} }] } }))
  await page.route('**/api/task-board*', route => route.fulfill({ json: {
    cards: [{ id: 't1', title: 'Task', note: '', status: 'done', archived: false, created_at: '', updated_at: '', workspace_id: null, due_date: null }],
    colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' },
    session_links: [{ workspace_id: '', session_id: 's1', task_ids: ['t1'], status_link_enabled: true }],
    revision: 1,
  } }))
  await page.goto('/space/chat-history')
  await expect(page.locator('.history-title strong')).toHaveText('新对话')
  await expect(page.locator('.history-row')).toHaveClass(/is-placeholder/)
  await expect(page.locator('.history-mark')).toHaveClass(/has-mark-color/)
  await expect(page.locator('.history-mark')).toHaveCSS('color', 'rgb(21, 128, 61)')
})
