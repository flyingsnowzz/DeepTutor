import { expect, test } from '@playwright/test'

test('appearance content follows applied language and waits for a draft to apply', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/settings/ui?*', route => route.fulfill({ json: {} }))
  await page.goto('/settings/general')
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en')
  await page.getByRole('link', { name: '外观' }).click()
  await expect(page.getByRole('heading', { name: '外观' })).toBeVisible()
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Code blocks' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Show line numbers' })).toBeVisible()
  await expect(page.getByLabel('Syntax theme')).toBeVisible()
})
