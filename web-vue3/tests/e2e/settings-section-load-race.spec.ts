import { expect, test } from '@playwright/test'

test('a late failure from the previous section does not replace the current section', async ({ page }) => {
  let releaseStarter!: () => void
  const starterHeld = new Promise<void>(resolve => { releaseStarter = resolve })
  let starterRequested!: () => void
  const starterStarted = new Promise<void>(resolve => { starterRequested = resolve })
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/chat-starters*', async route => {
    starterRequested()
    await starterHeld
    await route.fulfill({ status: 503, json: { detail: 'old section failed' } })
  })
  await page.route('**/api/settings/chat-attachments*', route => route.fulfill({ json: { settings: { max_file_mb: 64, max_total_mb: 90, max_chars_per_doc: 310000, max_chars_total: 480000 }, bounds: { max_file_mb: [1, 1024], max_total_mb: [1, 2048], chars: [10000, 5000000] }, effective: { ws_max_size: 104857600, max_file_bytes: 67108864, max_total_bytes: 94371840 } } }))
  await page.goto('/settings/starters')
  await starterStarted
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '附件' }).click()
  await expect(page.getByRole('spinbutton', { name: '单文件上限（MB）' })).toHaveValue('64')
  const lateResponse = page.waitForResponse(response => response.url().includes('/api/settings/chat-starters') && response.status() === 503)
  releaseStarter()
  await lateResponse
  await expect(page.getByRole('heading', { name: '附件' })).toBeVisible()
  await expect(page.locator('.legacy-settings-container p[role="alert"]')).toHaveCount(0)
})
