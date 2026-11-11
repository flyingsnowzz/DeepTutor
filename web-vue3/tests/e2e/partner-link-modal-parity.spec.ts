import { expect, test } from '@playwright/test'

test('partner link modal issues, copies and disconnects a chat account link', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/partners/p1?*', route => route.fulfill({ json: { partner_id: 'p1', name: 'Ada', emoji: '🦊', color: '#b0501e', running: true, can_manage: true, channels: {} } }))
  await page.route('**/api/partners/p1/sessions?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/history?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/web-continuity?*', route => route.fulfill({ json: { enabled: false, session_key: null } }))
  let connected = [{ key: 'old', channel: 'telegram', sender_id: 'old-user' }]
  await page.route('**/api/partners/p1/links?*', async route => {
    if (route.request().method() === 'DELETE') connected = []
    return route.fulfill({ json: connected })
  })
  await page.route('**/api/partners/p1/links/old?*', route => { connected = []; return route.fulfill({ json: {} }) })
  await page.route('**/api/partners/p1/links/code?*', route => route.fulfill({ json: { command: '/pair abc123', expires_at: '2026-11-10T12:10:00Z' } }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [] } }))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
  })
  await page.goto('/partners/p1')
  await page.getByRole('button', { name: '链接聊天账号' }).click()
  const dialog = page.getByRole('dialog', { name: '链接聊天账号' })
  await expect(dialog).toHaveCSS('width', '448px')
  await expect(dialog).toContainText('telegram · old-user')
  await dialog.getByRole('button', { name: '获取链接命令' }).click()
  await expect(dialog.locator('code')).toHaveText('/pair abc123')
  await expect(dialog).toContainText('15 分钟内有效，只能使用一次。')
  await dialog.getByRole('button', { name: '复制', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '断开连接' }).click()
  await expect(dialog).toContainText('还没有已连接的聊天账号。')
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toHaveCount(0)
})
