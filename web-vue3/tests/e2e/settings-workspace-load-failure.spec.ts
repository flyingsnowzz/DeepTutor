import { expect, test } from '@playwright/test'

test('workspace settings does not expose storage controls when catalog loading fails', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh' }, catalog: { connections: [], services: {} } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/workspace/registrations*', route => route.fulfill({ status: 503, json: { detail: 'unavailable' } }))
  await page.goto('/settings/workspace')
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.locator('.workspace-root-form')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建工作区' })).toBeDisabled()
})
