import { expect, test } from '@playwright/test'

test('conversation and attachment settings follow the applied interface language', async ({ page }) => {
  let appliedLanguage = 'zh'
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: appliedLanguage, response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/settings/ui?*', async route => {
    if (route.request().method() === 'PUT') appliedLanguage = (route.request().postDataJSON() as { language: string }).language
    await route.fulfill({ json: {} })
  })
  await page.route('**/api/settings/chat-starters*', route => route.fulfill({ json: { settings: { trace_count: 20 }, bounds: { trace_count: [3, 100] } } }))
  await page.route('**/api/settings/chat-attachments*', route => route.fulfill({ json: { settings: { max_file_mb: 20, max_total_mb: 25, max_chars_per_doc: 200000, max_chars_total: 150000 }, bounds: { max_file_mb: [1, 1024], max_total_mb: [1, 2048], chars: [10000, 5000000] }, effective: { ws_max_size: 104857600, max_file_bytes: 20971520, max_total_bytes: 26214400 } } }))
  await page.goto('/settings/general')
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en')
  await page.getByRole('button', { name: '应用更改' }).click()
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Conversation' }).click()
  await expect(page.getByRole('heading', { name: 'Starting points' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Recent activities' })).toHaveValue('20')
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Attachments' }).click()
  await expect(page.getByRole('heading', { name: 'Extraction budgets' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Max file size (MB)' })).toHaveValue('20')
})
