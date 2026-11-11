import { expect, test } from '@playwright/test'

test('favorite records expand, edit with preview, copy via submenu and confirm deletion', async ({ page }) => {
  const record = {
    id: 'r1', type: 'chat', title: 'Saved chat', summary: 'Summary',
    user_query: 'Question', output: '## User\n\nQuestion\n\n## Assistant\n\nAnswer',
    created_at: 1, metadata: { session_id: 's1', message_count: 2 },
  }
  const detail = { id: 'n1', name: 'Research', description: 'Sources', color: '#123456', records: [record] }
  const notebooks = [detail, { id: 'n2', name: 'Archive', color: '#6366F1', records: [], record_count: 0 }]
  let putBody: Record<string, unknown> | null = null
  let copyBody: Record<string, unknown> | null = null
  let deleted = false

  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks } }))
  await page.route('**/api/notebooks/n1?*', route => route.fulfill({ json: detail }))
  await page.route('**/api/notebooks/n1/records/r1?*', route => {
    if (route.request().method() === 'PUT') {
      putBody = route.request().postDataJSON() as Record<string, unknown>
      Object.assign(record, putBody)
      return route.fulfill({ json: record })
    }
    if (route.request().method() === 'DELETE') {
      deleted = true
      detail.records = []
      return route.fulfill({ json: {} })
    }
    return route.fulfill({ json: record })
  })
  await page.route('**/api/notebooks/n1/records/r1/actions/copy?*', async route => {
    copyBody = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ json: {} })
  })

  await page.goto('/notebooks/n1')
  const card = page.locator('.dt-fav-record')
  await expect(card.locator('.dt-fav-record-body')).toHaveCount(0)
  await card.locator('.dt-fav-record-toggle').click()
  await expect(page).toHaveURL(/record=r1/)
  await expect(card.locator('.dt-fav-record-content')).toContainText('Answer')
  await expect(card.getByRole('button', { name: '打开聊天会话' })).toBeVisible()

  await card.getByRole('button', { name: '编辑收藏详情', exact: true }).click()
  await card.getByRole('textbox', { name: '收藏标题' }).fill('Updated chat')
  await card.getByRole('button', { name: '预览', exact: true }).click()
  await expect(card.locator('.notebook-record-editor')).toContainText('Updated chat')
  await card.getByRole('button', { name: '继续编辑' }).click()
  await card.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => putBody?.title).toBe('Updated chat')

  await card.getByRole('button', { name: '收藏操作' }).click()
  await page.getByRole('menuitem', { name: /复制到/ }).click()
  await page.locator('.notebook-record-targets').getByRole('menuitem').click()
  expect(copyBody).toEqual({ target_notebook_id: 'n2' })

  await card.getByRole('button', { name: '收藏操作' }).click()
  await page.getByRole('menuitem', { name: /删除/ }).click()
  const confirmation = page.getByRole('alertdialog', { name: '删除这条收藏？' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '删除', exact: true }).click()
  expect(deleted).toBe(true)
  await expect(page.getByText('这个收藏夹是空的。')).toBeVisible()
})
