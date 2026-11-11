import { expect, test } from '@playwright/test'

test('chat session menu organizes, moves, links tasks and saves selected messages', async ({ page }) => {
  const session = {
    id: 's1', title: 'Study session', content_workspace_id: '',
    preferences: { pinned: false, archived: false, workspace_id: '' },
    messages: [
      { id: 1, role: 'user', content: 'Explain vectors' },
      { id: 2, role: 'assistant', content: 'Vectors have direction.' },
    ],
  }
  let organizationBodies: Record<string, unknown>[] = []
  let taskStatusBody: Record<string, unknown> | null = null
  let saveBody: Record<string, unknown> | null = null
  let board = { session_links: [{ workspace_id: '', session_id: 's1', task_ids: ['t1'], status_link_enabled: true }] }

  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session] } }))
  await page.route('**/api/sessions/s1?*', route => route.fulfill({ json: session }))
  await page.route('**/api/sessions/s1/organization?*', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    organizationBodies.push(body)
    session.preferences = { ...session.preferences, ...body }
    if (typeof body.workspace_id === 'string') session.content_workspace_id = body.workspace_id
    if (body.workspace_id === null) session.content_workspace_id = ''
    return route.fulfill({ json: { session } })
  })
  await page.route('**/api/settings/workspace/registrations?*', route => route.fulfill({ json: { workspaces: [
    { workspace_id: 'class', kind: 'workspace', display_name: 'Class', archived: false, status: 'ready' },
  ] } }))
  await page.route('**/api/task-board?*', route => route.fulfill({ json: board }))
  await page.route('**/api/task-board/sessions/s1/status?*', async route => {
    taskStatusBody = route.request().postDataJSON() as Record<string, unknown>
    board = { session_links: [{ ...board.session_links[0], status_link_enabled: Boolean(taskStatusBody.enabled) }] }
    return route.fulfill({ json: board })
  })
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [{ id: 'n1', name: 'Sources' }] } }))
  await page.route('**/api/notebooks/actions/add-record-with-summary?*', async route => {
    saveBody = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ contentType: 'text/plain', body: 'data: {"summary":"Saved"}\n\n' })
  })

  await page.goto('/chat/s1')
  await page.locator('.conversation-actions').getByRole('button', { name: '聊天操作' }).click()
  const menu = page.getByRole('menu', { name: '聊天操作' })
  await expect(menu).toHaveCSS('width', '240px')
  await expect(menu).toContainText('移动到工作区')
  await expect(menu).toContainText('Class')
  await expect(menu).toContainText('取消任务状态关联')
  await menu.getByRole('menuitem', { name: /置顶/ }).click()
  await expect.poll(() => organizationBodies.some(body => body.pinned === true)).toBe(true)

  await page.locator('.conversation-actions').getByRole('button', { name: '聊天操作' }).click()
  await page.getByRole('menuitem', { name: /归档/ }).click()
  await expect.poll(() => organizationBodies.some(body => body.archived === true)).toBe(true)

  await page.locator('.conversation-actions').getByRole('button', { name: '聊天操作' }).click()
  await page.getByRole('menuitem', { name: /取消任务状态关联/ }).click()
  await expect.poll(() => taskStatusBody).toEqual({ workspace_id: '', enabled: false })

  await page.locator('.conversation-actions').getByRole('button', { name: '聊天操作' }).click()
  await page.getByRole('menuitem', { name: /Class/ }).click()
  await expect(page).toHaveURL(/dt_workspace=class/)
  await expect.poll(() => organizationBodies.some(body => body.workspace_id === 'class')).toBe(true)

  await page.locator('.conversation-actions').getByRole('button', { name: '聊天操作' }).click()
  await page.getByRole('menuitem', { name: /保存到收藏夹/ }).click()
  const dialog = page.getByRole('dialog', { name: /保存到收藏夹/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.conversation-save-message')).toHaveCount(2)
  await dialog.getByRole('button', { name: '最近一轮' }).click()
  await expect(dialog.locator('.conversation-save-message input:checked')).toHaveCount(2)
  await dialog.locator('.conversation-save-notebooks label').click()
  await dialog.getByRole('button', { name: '保存到收藏夹', exact: true }).last().click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.notice')).toContainText('已保存到收藏夹')
  expect(saveBody).toMatchObject({ notebook_ids: ['n1'], record_type: 'chat' })
  expect(saveBody?.metadata).toMatchObject({ message_count: 2, total_message_count: 2, session_id: 's1' })
})
