import { expect, test } from '@playwright/test'

test('shared settings chrome follows the applied interface language', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/settings/ui?*', route => route.fulfill({ json: {} }))
  await page.goto('/settings/general')
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en')
  await expect(page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '常规' })).toBeVisible()
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'General' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Interface language' })).toHaveValue('en')
  await expect(page.getByRole('button', { name: 'Back to app' })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('Providers')
  await expect(page.getByRole('link', { name: 'Providers' })).toBeVisible()
})
