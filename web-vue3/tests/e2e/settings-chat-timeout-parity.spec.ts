import { expect, test } from '@playwright/test'

test('conversation timeout uses the same 180-second default as React', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/chat-starters*', route => route.fulfill({ json: { settings: { trace_count: 20 }, bounds: { trace_count: [3, 100] } } }))
  await page.goto('/settings/starters')
  const timeout = page.getByRole('spinbutton', { name: '超时时长（秒）' })
  await expect(timeout).toHaveValue('180')
  await timeout.fill('10')
  await timeout.blur()
  await expect(timeout).toHaveValue('30')
})

test('conversation timeout cannot be edited when its settings request fails', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ status: 503, json: { detail: 'unavailable' } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/chat-starters*', route => route.fulfill({ json: { settings: { trace_count: 20 }, bounds: { trace_count: [3, 100] } } }))
  await page.goto('/settings/starters')
  await expect(page.getByRole('spinbutton', { name: '超时时长（秒）' })).toBeDisabled()
  await expect(page.getByText('无法加载聊天响应超时设置。')).toBeVisible()
})

test('applying a conversation timeout updates the chat watchdog immediately', async ({ page }) => {
  let appliedSeconds = 180
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', response_language: 'zh', theme: 'snow', chat_response_timeout: appliedSeconds } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/settings/chat-starters*', route => route.fulfill({ json: { settings: { trace_count: 20 }, bounds: { trace_count: [3, 100] } } }))
  await page.route('**/api/settings/chat-response-timeout*', async route => {
    appliedSeconds = (route.request().postDataJSON() as { chat_response_timeout: number }).chat_response_timeout
    await route.fulfill({ json: { chat_response_timeout: appliedSeconds } })
  })
  await page.goto('/settings/starters')
  const timeout = page.getByRole('spinbutton', { name: '超时时长（秒）' })
  await timeout.fill('420')
  await timeout.blur()
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('deeptutor.chatResponseTimeout'))).toBe('420')
  expect(appliedSeconds).toBe(420)
})
