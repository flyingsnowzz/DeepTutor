import { expect, test } from '@playwright/test'

test('guardian material and restriction changes use the shared settings draft', async ({ page }) => {
  const applied: Record<string, unknown> = {}
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: false, preset: 'standard' } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/multi-user/me/guardianships*', route => route.fulfill({ json: { relationships: [{ id: 'r1', learner_user_id: 'u1', learner_username: 'Learner', permissions: ['assign_materials', 'manage_restrictions', 'view_reports'] }] } }))
  await page.route('**/api/multi-user/learners/u1/guardian-report*', route => route.fulfill({ json: { learner: { username: 'Learner' }, assigned_materials: [], grant_summary: { model_count: 0, knowledge_base_count: 0, skill_count: 0 } } }))
  await page.route('**/api/multi-user/learners/u1/materials*', async route => {
    if (route.request().method() === 'PUT') applied.materials = route.request().postDataJSON()
    await route.fulfill({ json: route.request().method() === 'GET' ? { materials: [{ book_id: 'b1', title: 'Book', assigned: false }] } : {} })
  })
  await page.route('**/api/multi-user/learners/u1/restrictions*', async route => {
    if (route.request().method() === 'PUT') applied.restrictions = route.request().postDataJSON()
    await route.fulfill({ json: route.request().method() === 'GET' ? { restrictions: { age_band: '9-12', allow_upload: false, allowed_surfaces: ['chat'], extensions: [] }, available_extensions: [{ id: 'translation', name: 'Translation' }] } : {} })
  })
  await page.goto('/settings/guardian')
  await page.getByRole('button', { name: /Learner/ }).click()
  await page.getByLabel('Book').check()
  await page.getByLabel('允许学习者上传').check()
  await expect(page.getByRole('button', { name: '应用更改' })).toBeVisible()
  expect(applied).toEqual({})
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect.poll(() => applied.materials).toEqual({ book_ids: ['b1'] })
  await expect.poll(() => applied.restrictions).toMatchObject({ age_band: '9-12', allow_upload: true, allowed_surfaces: ['chat'], extensions: [] })
})
