import { expect, test } from '@playwright/test'

test('attachment character budgets accept digit-by-digit editing before bounds are applied', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/settings/chat-attachments*', route => route.fulfill({ json: { settings: { max_file_mb: 20, max_total_mb: 25, max_chars_per_doc: 200000, max_chars_total: 150000 }, bounds: { max_file_mb: [1, 1024], max_total_mb: [1, 2048], chars: [10000, 5000000] }, effective: { ws_max_size: 104857600, max_file_bytes: 20971520, max_total_bytes: 26214400 } } }))
  await page.goto('/settings/attachments')
  const budget = page.getByRole('spinbutton', { name: '单文档字符上限' })
  await budget.fill('')
  await budget.pressSequentially('120000')
  await expect(budget).toHaveValue('120000')
  await budget.blur()
  await expect(budget).toHaveValue('120000')
  await budget.fill('9000')
  await budget.blur()
  await expect(budget).toHaveValue('10000')
})
