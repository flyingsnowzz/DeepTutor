import { expect, test } from '@playwright/test'

test('system workspace shows a sanitized configuration snapshot on request', async ({ page }) => {
  let refreshes = 0
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/workspace/registrations/system-snapshot*', route => {
    refreshes++
    return route.fulfill({ json: { generated_at: '2026-11-13T12:00:00Z', models: { llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', name: 'Local', models: [{ id: 'm1', name: 'Model One' }] }] } }, mcp: [{ name: 'Files', transport: 'stdio', enabled: true }] } })
  })
  await page.route('**/api/settings/workspace/registrations*', route => route.fulfill({ json: { root: '/tmp/workspaces', workspaces: [{ workspace_id: 'system', kind: 'system', display_name: 'System', path: '/tmp/workspaces/system', archived: false, status: 'ready', error: '', follows_root: true }] } }))
  await page.goto('/settings/workspace')
  await expect(page.getByRole('button', { name: '查看 / 刷新配置快照' })).toBeVisible()
  await expect(page.getByText('Model One')).toHaveCount(0)
  await page.getByRole('button', { name: '查看 / 刷新配置快照' }).click()
  await expect(page.getByText('Model One · 当前使用')).toBeVisible()
  await expect(page.getByText('Files · stdio · 已启用')).toBeVisible()
  expect(refreshes).toBe(1)
})
