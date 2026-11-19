import { expect, test } from '@playwright/test'

test('parser installer becomes cancel while a background job runs', async ({ page }) => {
  let starts = 0
  let cancels = 0
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/llm-options*', route => route.fulfill({ json: { options: [] } }))
  await page.route('**/api/settings/document-parsing*', route => route.fulfill({ json: { engine: 'markitdown', image_description_model: null, engines: { markitdown: {} }, available_engines: [{ id: 'markitdown', name: 'markitdown', description: '', available: false, needs_local_models: false }], readiness: {}, installable: ['markitdown'], mineru: { api_token_set: false } } }))
  await page.route('**/api/settings/document-parsing/install*', route => { starts++; return route.fulfill({ json: { ok: true } }) })
  await page.route('**/api/settings/document-parsing/job/status*', route => route.fulfill({ json: { state: 'running', kind: 'install', lines: [], next_cursor: 0 } }))
  await page.route('**/api/settings/document-parsing/job/cancel*', route => { cancels++; return route.fulfill({ json: { ok: true } }) })
  await page.goto('/settings/knowledge')
  await page.getByRole('button', { name: '下载并安装' }).click()
  await expect(page.getByRole('button', { name: '下载并安装' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '取消' }).first()).toBeVisible()
  await page.getByRole('button', { name: '取消' }).first().click()
  await expect.poll(() => starts).toBe(1)
  await expect.poll(() => cancels).toBe(1)
})
