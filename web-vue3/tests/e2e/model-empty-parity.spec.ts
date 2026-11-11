import { expect, test } from '@playwright/test'

test('empty language model workspace preserves the legacy provider guidance', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { catalog: { connections: [], services: { llm: { profiles: [] } } }, ui: { language: 'zh' }, task_kinds: [] } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto('/settings/llm')
  await expect(page.locator('.model-provider-empty')).toContainText('添加模型前，请先添加提供方。')
  await expect(page.locator('.model-provider-empty').getByRole('link', { name: '前往提供方' })).toHaveAttribute('href', '/settings/connections')
  await expect(page.getByLabel('模型筛选')).toHaveCount(0)
  await expect(page.locator('.model-rail-empty')).toHaveText('尚未配置模型。')
  await expect(page.locator('.model-detail-empty')).toHaveCSS('min-height', '288px')
  await expect(page.locator('.model-detail-empty')).toContainText('尚未选择')
})
