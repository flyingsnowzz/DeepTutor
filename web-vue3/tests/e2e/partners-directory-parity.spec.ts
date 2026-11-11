import { expect, test } from '@playwright/test'

test('partners directory matches the legacy page bar and empty collection', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route(/\/api\/partners(?:\?.*)?$/, route => route.fulfill({ json: [] }))
  await page.route(/\/api\/partner-groups(?:\?.*)?$/, route => route.fulfill({ json: [] }))
  await page.goto('/partners')
  await expect(page.locator('.partner-page-bar')).toBeVisible()
  await expect(page.locator('#partner-preview-title')).toHaveText('伙伴 0')
  await expect(page.locator('#group-preview-title')).toHaveText('群组 0')
  await expect(page.locator('.dt-partner-sessions')).toContainText('开始对话后，会话会保留在这里。')
  await expect(page.locator('.partner-page-content > .feature-heading')).toHaveCSS('position', 'absolute')
  await expect(page.locator('.partner-page .empty-state')).toHaveCSS('min-height', '360px')
  await expect(page.locator('.partner-page .empty-state')).toContainText('还没有伙伴')
  await expect(page.locator('.partner-page .empty-state svg').first()).toBeVisible()
  await page.locator('.partner-crumb').click()
  await expect(page.getByRole('menu', { name: '伙伴' }).getByRole('menuitem')).toHaveCount(1)
})
