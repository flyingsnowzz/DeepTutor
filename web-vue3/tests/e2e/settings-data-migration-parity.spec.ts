import { expect, test } from '@playwright/test'

test('data migration respects active workspace and unavailable or empty features', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/workspace/registrations*', route => route.fulfill({ json: { workspaces: [{ workspace_id: 'first', display_name: 'First' }, { workspace_id: 'current', display_name: 'Current' }] } }))
  await page.route('**/api/settings/workspace/data/discover*', route => route.fulfill({ json: { features: [{ feature: 'chat', files: 0, sessions: 0, bytes: 0, path: '/chat', error: '' }, { feature: 'book', files: 1, sessions: 0, bytes: 100, path: '/book', error: 'scan failed' }], historical: [{ path: '/old' }], session_backend: 'postgresql', transfer_available: false } }))
  await page.route('**/api/settings/workspace/data/operations*', route => route.fulfill({ json: { operations: [] } }))
  await page.goto('/settings/data-migration?dt_workspace=current')
  await expect(page.getByLabel('来源工作区')).toHaveValue('current')
  await expect(page.getByText('PostgreSQL 工作区暂不支持功能包迁移。')).toBeVisible()
  await expect(page.locator('.data-migration-settings fieldset')).toHaveAttribute('disabled', '')
  await expect(page.getByRole('button', { name: '预览迁移' })).toBeDisabled()
  await expect(page.getByText('其他历史数据（1）')).toBeVisible()
})
