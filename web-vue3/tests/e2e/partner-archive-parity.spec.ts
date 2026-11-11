import { expect, test } from '@playwright/test'

const partner = { partner_id: 'p1', name: 'Researcher', description: 'Finds sources', emoji: '🦉', color: '#6d5a8c', running: true, can_manage: true, channels: [] }
const sessions = [
  { session_key: 'default', title: 'Current research', archived: false, updated_at: new Date().toISOString(), message_count: 2, last_message: 'Question about sources **and** a useful answer.', chat_id: 'group-42', scope: 'group' },
  { session_key: 'old', title: 'Earlier questions', archived: true, updated_at: new Date(Date.now() - 86400000).toISOString(), message_count: 1, last_message: 'An older archived question', chat_id: 'direct-alice', scope: 'direct' },
]
const history: Record<string, any[]> = {
  default: [
    { role: 'user', content: 'Question about sources', timestamp: new Date().toISOString() },
    { role: 'assistant', content: '**Answer** with a useful source.', timestamp: new Date().toISOString() },
  ],
  old: [{ role: 'user', content: 'Older archived question', timestamp: new Date(Date.now() - 86400000).toISOString() }],
}

test('partner history mirrors the two-column archives view and resumes a conversation', async ({ page }) => {
  let resumed = ''
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/partners/p1?*', route => route.fulfill({ json: partner }))
  await page.route('**/api/partners/p1/sessions?*', route => route.fulfill({ json: sessions }))
  await page.route('**/api/partners/p1/history?*', route => {
    const key = new URL(route.request().url()).searchParams.get('session_key') || 'default'
    return route.fulfill({ json: history[key] || [] })
  })
  await page.route('**/api/partners/p1/web-continuity?*', route => route.fulfill({ json: { enabled: false, session_key: 'default' } }))
  await page.route('**/api/partners/p1/links?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/sessions/resume?*', async route => {
    resumed = route.request().postDataJSON().session_key
    await route.fulfill({ json: {} })
  })
  await page.goto('/partners/p1')
  await page.getByRole('tab', { name: '历史记录' }).click()

  const layout = page.locator('.partner-archive-layout')
  await expect(layout.locator('.partner-archive-list h2')).toHaveText('聊天')
  await expect(layout.locator('.partner-archive-list header p')).toHaveText('2 个会话')
  const cards = layout.locator('.partner-archive-session')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toHaveClass(/active/)
  await expect(cards.first()).toContainText('Current research')
  await expect(cards.first()).toContainText('Question about sources and a useful answer.')
  await expect(cards.first()).toContainText('group-42')
  await expect(cards.nth(1)).toContainText('Earlier questions')
  await expect(cards.nth(1)).toContainText('direct-alice')
  expect((await cards.first().boundingBox())?.width).toBe(263)

  await expect(layout.locator('.partner-archive-detail-head h3')).toHaveText('Current research')
  await expect(layout.locator('.partner-archive-detail-actions>span')).toHaveText('2 条消息')
  await expect(layout.getByRole('button', { name: '继续', exact: true })).toBeVisible()
  await expect(layout.getByRole('button', { name: '删除对话', exact: true }).locator('svg')).toHaveAttribute('width', '14')
  await expect(layout.locator('.partner-archive-message.is-user>div')).toHaveCSS('border-radius', '8px')
  await expect(layout.locator('.partner-archive-message.is-assistant>div')).toHaveCSS('border-radius', '8px')

  await cards.nth(1).click()
  await expect(layout.locator('.partner-archive-detail-head h3')).toHaveText('Earlier questions')
  await expect(layout.locator('.partner-archive-detail-head p')).toContainText('已归档')
  await expect(layout.locator('.partner-archive-messages')).toContainText('Older archived question')

  await layout.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(() => resumed).toBe('old')
  await expect(page.getByRole('tab', { name: '聊天' })).toHaveAttribute('aria-selected', 'true')
})
