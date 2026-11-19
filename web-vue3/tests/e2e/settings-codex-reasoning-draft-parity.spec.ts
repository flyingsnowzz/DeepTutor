import { expect, test } from '@playwright/test'

test('saved Codex reasoning draft applies each model setting', async ({ page }) => {
  const applied: unknown[] = []
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: { extensions: { 'codex-reasoning': { 'model-a': 'high', 'model-b': null } } } } : {} }))
  await page.route('**/api/settings/providers/openai-codex/models/reasoning-effort*', async route => {
    applied.push(route.request().postDataJSON())
    await route.fulfill({ json: {} })
  })
  await page.goto('/settings/general')
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect.poll(() => applied.length).toBe(2)
  expect(applied).toEqual([{ model: 'model-a', reasoning_effort: 'high' }, { model: 'model-b', reasoning_effort: null }])
})
