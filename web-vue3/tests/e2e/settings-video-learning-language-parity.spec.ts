import { expect, test } from '@playwright/test'

test('video learning settings shows English controls and tests the current draft', async ({ page }) => {
  const settings = { version: 1, default_provider: 'youtube', youtube: { transcript_provider: 'youtube_transcript_api' }, invidious: { api_base_url: 'https://old.example', public_base_url: '' } }
  let tested: Record<string, any> | null = null
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog: { connections: [], services: {} } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/video-learning/test-invidious*', route => { tested = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, message: 'ready' } }) })
  await page.route('**/api/settings/video-learning*', route => route.fulfill({ json: settings }))
  await page.goto('/settings/video-learning')
  await expect(page.getByRole('heading', { name: 'Video Learning' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Backend API origin' }).fill('https://new.example')
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.getByText('Invidious connected (ready).')).toBeVisible()
  expect(tested?.invidious.api_base_url).toBe('https://new.example')
})
