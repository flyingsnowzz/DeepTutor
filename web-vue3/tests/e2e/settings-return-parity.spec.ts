import { expect, test } from '@playwright/test'

test('settings return uses the last non-settings page instead of always returning to chat', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false } }))
  await page.goto('/knowledge-bases')
  await page.goto('/settings/general')
  await page.getByRole('button', { name: '返回应用', exact: true }).first().click()
  await expect(page).toHaveURL(/\/knowledge-bases/)
})

test('settings unsaved return offers draft, continue editing and leave without saving', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false } }))
  await page.route('**/api/settings**', route => route.fulfill({ json: { ui: { language: 'zh-CN', response_language: 'zh-CN', layout: 'classic' }, draft: null } }))
  await page.route('**/api/settings/ui-layout**', route => route.fulfill({ json: {} }))
  await page.route('**/api/settings/draft**', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/capabilities/registered*', route => route.fulfill({ json: [] }))
  await page.goto('/calendar')
  await page.goto('/settings/general')
  await page.getByLabel('界面语言').selectOption({ index: 1 }).catch(() => undefined)
  await page.getByRole('button', { name: '返回应用', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '保留更改？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '返回应用', exact: true }).first().click()
  await page.getByRole('button', { name: '不保存，直接返回', exact: true }).click()
  await expect(page).toHaveURL(/\/calendar/)
})
