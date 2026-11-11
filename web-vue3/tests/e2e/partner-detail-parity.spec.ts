import { expect, test } from '@playwright/test'

test('partner detail restores tabs, chat, history and account actions', async ({ page }) => {
  const partner = { partner_id: 'p1', name: 'Researcher', description: 'Finds sources', emoji: '🦉', color: '#6d5a8c', running: true, can_manage: true }
  const sessions = [{ session_key: 'default', title: 'Current', archived: false }, { session_key: 'old', title: 'Earlier', archived: true }]
  await page.route('**/api/partners/p1?*', route => route.fulfill({ json: partner }))
  await page.route('**/api/partners/p1/sessions?*', route => route.fulfill({ json: sessions }))
  await page.route('**/api/partners/p1/history?*', route => {
    const key = new URL(route.request().url()).searchParams.get('session_key')
    return route.fulfill({ json: [{ role: 'user', content: key === 'old' ? 'Earlier question' : 'Question' }, { role: 'assistant', content: '**Answer**' }] })
  })
  await page.route('**/api/partners/p1/web-continuity?*', route => route.fulfill({ json: { enabled: false, session_key: 'default' } }))
  await page.route('**/api/partners/p1/links?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/links/code?*', route => route.fulfill({ json: { command: '/link abc123' } }))
  let saveBody: Record<string, unknown> | null = null
  await page.route('**/api/notebooks?*', route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { id: 'n2', name: 'New notebook' } })
    return route.fulfill({ json: { notebooks: [{ id: 'n1', name: 'Research', description: 'Saved sources', record_count: 3 }] } })
  })
  await page.route('**/api/notebooks/actions/add-record-with-summary?*', async route => {
    saveBody = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ contentType: 'text/plain', body: `data: {"type":"summary_chunk","content":"Generated summary"}\n\ndata: {"type":"result","summary":"Generated summary","added_to_notebooks":["n1"]}\n\n` })
  })
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.goto('/partners/p1')
  await expect(page.locator('.partner-direct-tabs [role="tab"]')).toHaveCount(4)
  await expect(page.locator('.partner-sessions')).toHaveCount(0)
  await expect(page.locator('.partner-direct-message-column')).toContainText('Question')
  await page.getByRole('button', { name: '保存到收藏夹', exact: true }).click()
  const saveDialog = page.getByRole('dialog', { name: '保存到收藏夹' })
  await expect(saveDialog).toContainText('Research')
  await expect(saveDialog).toContainText('Saved sources')
  await expect(saveDialog).toContainText('摘要预览')
  await saveDialog.locator('.conversation-save-notebooks label').click()
  await saveDialog.locator('footer .primary').click()
  await expect(saveDialog).toHaveCount(0)
  await expect(page.locator('.notice')).toContainText('已保存到收藏夹')
  expect(saveBody).toMatchObject({ record_type: 'tutorbot', notebook_ids: ['n1'], metadata: { source: 'partner', partner_id: 'p1', partner_name: 'Researcher' } })
  await page.getByRole('button', { name: '链接聊天账号', exact: true }).click()
  await page.getByRole('button', { name: '获取链接命令' }).click()
  await expect(page.locator('.partner-link-code-card code')).toContainText('/link abc123')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('tab', { name: /历史/ }).click()
  await expect(page.locator('.partner-archive-session')).toHaveCount(2)
  await page.locator('.partner-archive-session').nth(1).click()
  await expect(page.locator('.partner-archive-messages')).toContainText('Earlier question')
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '删除对话', exact: true })).toBeVisible()
})
