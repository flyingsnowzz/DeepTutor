import { expect, test } from '@playwright/test'

test('Docling remote settings remain available without the local package', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/llm-options*', route => route.fulfill({ json: { options: [] } }))
  await page.route('**/api/settings/document-parsing*', route => route.fulfill({ json: { engine: 'docling', image_description_model: null, engines: { docling: { mode: 'local', api_base_url: '' } }, available_engines: [{ id: 'docling', name: 'Docling', description: '', available: false, needs_local_models: true }], readiness: {}, installable: ['docling'], mineru: { api_token_set: false } } }))
  await page.goto('/settings/knowledge')
  await expect(page.getByRole('heading', { name: 'Docling 后端' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Docling（本地）' })).toBeVisible()
  await page.getByRole('button', { name: '远程服务器' }).click()
  await expect(page.getByRole('textbox', { name: '服务器地址' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Docling（本地）' })).toHaveCount(0)
})
