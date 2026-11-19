import { expect, test } from '@playwright/test'

test('workspace settings and nested controls follow the applied English language', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/workspace/resources?*', route => route.fulfill({ json: { skills: [{ id: 'skill-1', name: 'Writing' }], mcp: [], knowledge_bases: [] } }))
  await page.route('**/api/settings/workspace/registrations/system-snapshot*', route => route.fulfill({ json: { generated_at: '2026-11-13T12:00:00Z', models: {}, mcp: [] } }))
  await page.route('**/api/settings/workspace/registrations*', route => route.fulfill({ json: { root: '/tmp/workspaces', workspaces: [
    { workspace_id: 'system', kind: 'system', display_name: 'System', path: '/tmp/workspaces/system', archived: false, status: 'ready', error: '', follows_root: true },
    { workspace_id: 'general', kind: 'general', display_name: 'General', path: '/tmp/workspaces/general', archived: false, status: 'ready', error: '', follows_root: true },
  ] } }))

  await page.goto('/settings/workspace')
  await expect(page.getByRole('heading', { name: 'Storage location' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'System workspace' })).toBeVisible()
  await page.getByRole('button', { name: 'New workspace' }).click()
  await expect(page.getByRole('textbox', { name: 'Workspace name' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Skills' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Skills' }).getByRole('option', { name: 'Inherit available resources' })).toBeAttached()
  await page.getByRole('article', { name: 'System workspace' }).getByRole('button', { name: 'View / refresh configuration snapshot' }).click()
  await expect(page.getByText('No models or MCP servers configured.')).toBeVisible()
})

test('resource load failure does not mark assigned resources as missing', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/workspace/resources?*', route => route.fulfill({ status: 503, json: { detail: 'catalog unavailable' } }))
  await page.route('**/api/settings/workspace/registrations*', route => route.fulfill({ json: { root: '/tmp/workspaces', workspaces: [
    { workspace_id: 'general', kind: 'general', display_name: 'General', path: '/tmp/workspaces/general', archived: false, status: 'ready', error: '', follows_root: true, resources: { skills: ['skill-1'], mcp: null, knowledge_bases: null } },
  ] } }))

  await page.goto('/settings/workspace')
  await page.getByRole('article', { name: 'Default workspace' }).getByRole('button', { name: 'Assign resources' }).click()
  await expect(page.getByRole('article', { name: 'Default workspace' }).getByRole('alert').getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByText('Resource missing or access removed')).toHaveCount(0)
  await expect(page.getByText('Loading resources…')).toHaveCount(0)
})

test('workspace row keeps its editor open when post-save catalog refresh fails', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  let catalogReads = 0
  let saved = false
  await page.route('**/api/settings/workspace/registrations/w1*', route => {
    saved = true
    return route.fulfill({ json: { workspace_id: 'w1' } })
  })
  await page.route('**/api/settings/workspace/registrations*', route => {
    if (++catalogReads > 1) return route.fulfill({ status: 503, json: { detail: 'refresh failed' } })
    return route.fulfill({ json: { root: '/tmp/workspaces', workspaces: [
      { workspace_id: 'w1', kind: 'workspace', display_name: 'Research', path: '/tmp/workspaces/w1', archived: false, status: 'ready', error: '', follows_root: true },
    ] } })
  })

  await page.goto('/settings/workspace')
  await page.getByRole('article', { name: 'Research' }).getByRole('button', { name: 'Rename workspace' }).click()
  await page.getByRole('article', { name: 'Research' }).getByRole('textbox', { name: 'Workspace name' }).fill('Research 2')
  await page.getByRole('article', { name: 'Research' }).getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => saved).toBe(true)
  await expect(page.getByRole('article', { name: 'Research' }).getByRole('textbox', { name: 'Workspace name' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Workspace updated' })).toHaveCount(0)
  await expect(page.getByRole('alert').first()).toBeVisible()
})
