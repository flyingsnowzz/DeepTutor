import { expect, test } from '@playwright/test'

const now = Math.floor(Date.now() / 1000)

async function mockShell(page: import('@playwright/test').Page, sessions: Array<any>) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/capabilities/registered*', route => route.fulfill({ json: [] }))
  await page.route('**/api/dashboard/learning-index*', route => route.fulfill({ json: { sources: { books: [], mastery: [], reading: [], watching: [], practice: [] } } }))
  await page.route('**/api/sessions?limit=200*', route => route.fulfill({ json: { sessions } }))
  await page.route('**/api/task-board?*', route => route.fulfill({ json: { cards: [], revision: 0, colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [] } }))
  await page.route('**/api/calendar/task-blocks?*', route => route.fulfill({ json: {} }))
}

function session(id: string, title: string, ageSeconds: number, preferences: Record<string, unknown> = {}, status = 'idle') {
  return { id, session_id: id, title, created_at: now - ageSeconds - 10, updated_at: now - ageSeconds, status, preferences }
}

test('sidebar groups chat records by day with pinned rows and legacy controls', async ({ page }) => {
  const sessions = [
    session('p1', 'Pinned plan', 300, { pinned: true }),
    session('t1', 'New conversation', 120, {}, 'failed'),
    session('w1', 'This week notes', 3 * 86400),
    session('e1', 'Earlier notes', 10 * 86400),
    session('a1', 'Archived notes', 60, { archived: true }),
    session('child', 'Tutor child', 60, { parent_session_id: 't1' }),
    session('learn', 'Learning record', 60, { workspace_mode: 'mastery_path', mastery_path_id: 'path1' }),
  ]
  await mockShell(page, sessions)
  await page.goto('/kanban')

  const records = page.locator('.dt-session-section')
  await expect(records.locator('.dt-navigation-heading h2')).toHaveText('对话记录 4')
  await expect(records.locator('.dt-navigation-heading h2')).toHaveCSS('font-size', '12px')
  await expect(records.locator('.dt-navigation-heading h2')).toHaveCSS('line-height', '18px')
  await expect(records.locator('.dt-record-group > h2')).toHaveText(['已置顶', '今天', '一周内', '更早'])
  await expect(records.locator('.dt-record-node-row')).toHaveCount(4)
  await expect(records).not.toContainText('Archived notes')
  await expect(records).not.toContainText('Tutor child')
  await expect(records).not.toContainText('Learning record')
  await expect(records).toContainText('2分钟前')
  await expect(records).toContainText('3天前')
  await expect(records).toContainText('上周')

  const failedMark = records.locator('.dt-session-mark.is-failed')
  await expect(failedMark).toHaveCount(1)
  const markBox = await failedMark.boundingBox()
  expect(markBox?.width).toBe(12)
  expect(markBox?.height).toBe(12)
  const innerMark = await failedMark.evaluate(element => {
    const style = getComputedStyle(element, '::before')
    return { width: style.width, height: style.height, background: style.backgroundColor }
  })
  expect(innerMark).toEqual({ width: '6px', height: '6px', background: 'rgb(245, 158, 11)' })

  await records.getByRole('button', { name: '排序方式' }).click()
  await expect(records.getByRole('menuitemradio')).toHaveText(['最后一次活跃 ', '创建时间 '])
  await expect(records.getByRole('menuitemradio', { name: '最后一次活跃' })).toHaveAttribute('aria-checked', 'true')
  await records.getByRole('menuitemradio', { name: '创建时间' }).click()

  await records.getByRole('button', { name: '搜索对话' }).click()
  await records.getByRole('searchbox', { name: '搜索对话' }).fill('week')
  await expect(records.locator('.dt-record-node-row')).toHaveCount(1)
  await expect(records).toContainText('This week notes')
  await records.getByRole('button', { name: '清除搜索' }).click()
  await expect(records.getByRole('searchbox', { name: '搜索对话' })).toHaveCount(0)
  await expect(records.locator('.dt-record-node-row')).toHaveCount(4)
})

test('sidebar shows thirty chat records first and expands to the rest', async ({ page }) => {
  const sessions = Array.from({ length: 35 }, (_, index) => session(`s${index}`, `Conversation ${index}`, 60 + index))
  await mockShell(page, sessions)
  await page.goto('/kanban')
  const records = page.locator('.dt-session-section')
  await expect(records.locator('.dt-record-node-row')).toHaveCount(30)
  await records.getByRole('button', { name: /展开显示/ }).click()
  await expect(records.locator('.dt-record-node-row')).toHaveCount(35)
})

test('sidebar session menu performs pin, archive, workspace move and delete requests', async ({ page }) => {
  let rows = [session('s1', 'Workspace chat', 60, { workspace_id: 'w1' }), session('s2', 'Delete me', 120, { workspace_id: 'w1' })]
  rows[0].content_workspace_id = 'w1'
  rows[1].content_workspace_id = 'w1'
  const workspaces = [
    { workspace_id: 'w1', kind: 'workspace', display_name: 'Research', path: '/w1', archived: false, created_at: '', status: 'ready', follows_root: false },
    { workspace_id: 'w2', kind: 'workspace', display_name: 'Second workspace', path: '/w2', archived: false, created_at: '', status: 'ready', follows_root: false },
  ]
  const patches: Array<{ id: string; workspace: string; body: any }> = []
  const deletes: string[] = []
  await mockShell(page, rows)
  await page.unroute('**/api/sessions?limit=200*')
  await page.route('**/api/sessions?limit=200*', route => route.fulfill({ json: { sessions: rows } }))
  await page.route('**/api/settings/workspace/registrations*', route => route.fulfill({ json: { workspaces } }))
  await page.route(url => url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/organization'), async route => {
    const id = route.request().url().split('/sessions/')[1].split('/organization')[0]
    const workspace = new URL(route.request().url()).searchParams.get('dt_workspace') || ''
    const body = route.request().postDataJSON()
    patches.push({ id, workspace, body })
    rows = rows.map(row => row.session_id === id
      ? { ...row, content_workspace_id: body.workspace_id ?? row.content_workspace_id, preferences: { ...row.preferences, ...body } }
      : row)
    await route.fulfill({ json: { session: rows.find(row => row.session_id === id) } })
  })
  await page.route(url => url.pathname === '/api/sessions/s2', async route => {
    if (route.request().method() !== 'DELETE') return route.continue()
    deletes.push(route.request().url())
    rows = rows.filter(row => row.session_id !== 's2')
    await route.fulfill({ json: {} })
  })
  await page.goto('/kanban')
  const records = page.locator('.dt-session-section')
  const openMenu = async () => {
    await records.locator('.dt-record-node-row').filter({ hasText: 'Workspace chat' }).getByRole('button', { name: '聊天操作', exact: true }).click()
    return records.getByRole('menu')
  }

  let menu = await openMenu()
  await expect(menu).toHaveCSS('width', '240px')
  await expect(menu.getByRole('menuitem')).toHaveText(['重命名对话', '置顶', '归档', '通用工作区', 'Research', 'Second workspace', '删除对话'])
  await menu.getByRole('menuitem', { name: 'Second workspace' }).click()
  await expect.poll(() => patches).toContainEqual({ id: 's1', workspace: 'w1', body: { workspace_id: 'w2' } })

  menu = await openMenu()
  await menu.getByRole('menuitem', { name: '置顶' }).click()
  await expect.poll(() => patches).toContainEqual({ id: 's1', workspace: 'w2', body: { pinned: true } })
  await expect(records.locator('.dt-record-group').first().locator('h2')).toHaveText('已置顶')
  menu = await openMenu()
  await expect(menu.getByRole('menuitem', { name: '取消置顶' })).toBeVisible()
  await menu.getByRole('menuitem', { name: '归档' }).click()
  await expect.poll(() => patches).toContainEqual({ id: 's1', workspace: 'w2', body: { archived: true } })
  await expect(records).not.toContainText('Workspace chat')

  const confirmation = page.once('dialog', async dialog => {
    expect(dialog.message()).toBe('永久删除此对话及其导师子对话？此操作无法撤销。')
    await dialog.accept()
  })
  await records.locator('.dt-record-node-row').filter({ hasText: 'Delete me' }).getByRole('button', { name: '聊天操作', exact: true }).click()
  await records.getByRole('menuitem', { name: '删除对话' }).click()
  await confirmation
  await expect.poll(() => deletes).toHaveLength(1)
  await expect(records).not.toContainText('Delete me')
})

test('sidebar renames a chat inline and commits with Enter or blur', async ({ page }) => {
  let rows = [session('s1', 'Workspace chat', 60, { workspace_id: 'w1' })]
  rows[0].content_workspace_id = 'w1'
  const renames: Array<{ workspace: string; body: any }> = []
  await mockShell(page, rows)
  await page.unroute('**/api/sessions?limit=200*')
  await page.route('**/api/sessions?limit=200*', route => route.fulfill({ json: { sessions: rows } }))
  await page.route('**/api/settings/workspace/registrations*', route => route.fulfill({ json: { workspaces: [] } }))
  await page.route(url => url.pathname === '/api/sessions/s1' && url.searchParams.has('dt_workspace'), async route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    const body = route.request().postDataJSON()
    renames.push({ workspace: new URL(route.request().url()).searchParams.get('dt_workspace') || '', body })
    rows = rows.map(row => ({ ...row, title: body.title }))
    await route.fulfill({ json: { session: rows[0] } })
  })
  await page.goto('/kanban')
  const records = page.locator('.dt-session-section')
  const openRename = async () => {
    await records.getByRole('button', { name: '聊天操作', exact: true }).click()
    await records.getByRole('menuitem', { name: '重命名对话' }).click()
  }

  await openRename()
  const input = records.getByRole('textbox', { name: '对话标题' })
  await expect(input).toHaveValue('Workspace chat')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await input.fill('Renamed inline')
  await input.press('Enter')
  await expect.poll(() => renames).toContainEqual({ workspace: 'w1', body: { title: 'Renamed inline' } })
  await expect(records).toContainText('Renamed inline')
  await expect(input).toHaveCount(0)

  await openRename()
  await expect(input).toHaveValue('Renamed inline')
  await input.fill('Escape should cancel')
  await input.press('Escape')
  await expect(records).toContainText('Renamed inline')
  expect(renames).toHaveLength(1)

  await openRename()
  await input.fill('Saved on blur')
  await records.locator('.dt-record-header').click()
  await expect.poll(() => renames).toContainEqual({ workspace: 'w1', body: { title: 'Saved on blur' } })
  await expect(records).toContainText('Saved on blur')
})
