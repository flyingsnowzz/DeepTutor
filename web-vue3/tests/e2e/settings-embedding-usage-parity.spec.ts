import { expect, test } from '@playwright/test'

test('embedding settings shows knowledge bases using the selected model', async ({ page }) => {
  const catalog = { connections: [], services: {
    embedding: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', name: 'Embed', provider: 'openai', models: [{ id: 'm1', model: 'embed-v1' }] }] },
  } }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog, task_kinds: [] } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/knowledge-bases/embedding-usage*', route => route.fulfill({ json: { knowledge_bases: [
    { profile_id: 'p1', model_id: 'm1', name: 'Algebra', workspace_name: 'Class A' },
    { profile_id: 'p1', model_id: 'm2', name: 'Biology' },
  ] } }))
  await page.goto('/settings/embedding')
  const card = page.getByRole('region', { name: 'Knowledge bases using this model' })
  await expect(card).toContainText('Knowledge bases using this model (1)')
  await expect(card).toContainText('Algebra · Class A')
  await expect(card).not.toContainText('Biology')
  await expect(card).toContainText('documents and indexes will be preserved')
})
