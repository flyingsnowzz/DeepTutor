import { expect, test } from '@playwright/test'

test('conversation and attachment controls wait for their own settings to load', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/chat-starters*', route => route.fulfill({ status: 503, json: { detail: 'starter unavailable' } }))
  await page.route('**/api/settings/chat-attachments*', route => route.fulfill({ status: 503, json: { detail: 'attachments unavailable' } }))
  await page.goto('/settings/starters')
  await expect(page.locator('.legacy-settings-container p[role="alert"]')).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '近期活动条数' })).toHaveCount(0)
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '附件' }).click()
  await expect(page.locator('.legacy-settings-container p[role="alert"]')).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '单文件上限（MB）' })).toHaveCount(0)
})
