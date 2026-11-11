import { expect, test } from '@playwright/test'

test('personas uses legacy page chrome and full two-column preset cards', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route(/\/api\/personas(?:\?.*)?$/, route => route.fulfill({ json: { personas: [{ name: 'teacher', description: 'Patient Socratic tutor', source: 'admin', read_only: true }] } }))
  await page.goto('/space/personas')
  await expect(page.locator('.persona-page-bar')).toContainText('1 个人格')
  await expect(page.getByRole('searchbox', { name: '搜索 Persona' })).toHaveCount(0)
  await expect(page.locator('.resource-card-grid')).toHaveCSS('grid-template-columns', /.+ .+/)
  await expect(page.locator('.resource-item-card')).toHaveCSS('min-height', '94px')
  await expect(page.locator('.persona-preset-badge')).toHaveText('预设')
  await expect(page.locator('.resource-item-heading p')).toHaveCSS('overflow', 'visible')
  await expect(page.locator('.persona-crumb svg')).toBeVisible()
  await expect(page.locator('.resource-item-icon svg')).toBeVisible()
  await expect(page.locator('.resource-item-card>small')).toHaveCount(0)
  await page.locator('.persona-crumb').click()
  await expect(page.getByRole('menu', { name: '个性化' }).getByRole('menuitem')).toHaveCount(7)
})
