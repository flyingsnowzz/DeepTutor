import { expect, test } from '@playwright/test'

test('CLI Apps restores the legacy page chrome, store tab and empty state', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/space/cli-apps/apps', route => route.fulfill({ json: { apps: [], access: { exec_denied: false } } }))
  await page.route('**/api/space/cli-apps/catalog?*', route => route.fulfill({ json: { entries: [], categories: {}, next_cursor: '', total: 0 } }))
  await page.goto('/space/cli-apps')
  await expect(page.locator('.cli-page-bar')).toContainText('你可用 0 个')
  await expect(page.getByRole('button', { name: '已安装 0' })).toBeVisible()
  await expect(page.getByRole('button', { name: '商店', exact: true })).toBeVisible()
  await expect(page.locator('.cli-empty')).toContainText('还没有安装 CLI 应用')
  await expect(page.locator('.cli-empty')).toContainText('这些由管理员安装，再分配给各账号。可以先在商店里看看，然后按名字向管理员申请。')
  await page.getByRole('button', { name: '浏览商店', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: '搜索应用' })).toBeVisible()
  await page.getByRole('button', { name: '已安装 0' }).click()
  await page.locator('.cli-crumb').click()
  await expect(page.getByRole('menu', { name: '个性化' }).getByRole('menuitem')).toHaveCount(7)
})
