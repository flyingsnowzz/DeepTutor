import { expect, test } from '@playwright/test'

test('learner profile edits wait for the shared apply action', async ({ page }) => {
  let saved: unknown = null
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: false, preset: 'learner' } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/auth/profile/learner-profile*', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON()
    return route.fulfill({ json: { learner_profile: { age: 12, grade_level: '7' } } })
  })
  await page.goto('/settings/learner-profile')
  await page.getByRole('spinbutton', { name: '年龄' }).fill('13')
  expect(saved).toBeNull()
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect.poll(() => saved).toMatchObject({ age: 13, grade_level: '7' })
})

test('update check preference waits for the shared apply action', async ({ page }) => {
  let saved: unknown = null
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/system/update?*', route => route.fulfill({ json: { current_version: '1.0.0', check_enabled: true, checked_at: '', check_error: '', update_available: false, release: null, installation: { mode: 'source', automatic_update: false, command: '', reason: '' }, launcher_managed: false, is_admin: true, job: null } }))
  await page.route('**/api/system/update/settings*', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON()
    return route.fulfill({ json: {} })
  })
  await page.goto('/settings/about')
  await page.getByRole('switch', { name: '检查更新' }).click()
  expect(saved).toBeNull()
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect.poll(() => saved).toEqual({ enabled: false })
})
