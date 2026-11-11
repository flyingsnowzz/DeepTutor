import { expect, test } from '@playwright/test'

test('assignment editor restores legacy summary, learning policy and segmented tool modes', async ({ page }) => {
  const users = [
    { id: 'u1', username: 'admin', role: 'admin', preset: 'custom', created_at: '2026-01-01' },
    { id: 'u2', username: 'learner', role: 'user', preset: 'standard', created_at: '2026-01-02' },
  ]
  const resources = {
    models: { llm: [{ profile_id: 'default', name: 'Default', models: [{ model_id: 'chat', name: 'Chat' }] }] },
    knowledge_bases: [{ resource_id: 'kb1', name: 'KB One' }],
    skills: [{ name: 'research', description: 'Research' }],
    partners: [{ partner_id: 'p1', name: 'Partner' }],
    reading_materials: [{ material_id: 'm1', title: 'Material', filename: 'm.pdf' }],
    reading_extensions: [{ id: 'translate', name: 'Translate', version: '1.0' }],
    tools: [{ name: 'web_search', description: 'Search' }],
    mcp_tools: [{ name: 'mcp', provider_id: 'test' }],
  }
  const grant = { version: 2, user_id: 'u2', models: { llm: [] }, knowledge_bases: [], skills: [], partners: [], enabled_tools: null, mcp_tools: null, exec_enabled: null, learning_policy: null }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true, is_super_admin: true, username: 'admin' } }))
  await page.route('**/api/auth/users?*', route => route.fulfill({ json: users }))
  await page.route('**/api/multi-user/admin/resources?*', route => route.fulfill({ json: resources }))
  await page.route('**/api/multi-user/users/u2/grants?*', route => route.fulfill({ json: { grant } }))
  await page.route('**/api/multi-user/admin/books?*', route => route.fulfill({ json: { books: [] } }))
  await page.route('**/api/multi-user/users/u2/book-permission?*', route => route.fulfill({ json: { permission: { create: true, default: 'none', books: {} } } }))
  await page.goto('/admin/users')
  await page.getByRole('button', { name: '分配权限', exact: true }).click()
  await expect(page.locator('.admin-grant-summary')).toContainText('0 个模型')
  await expect(page.locator('.admin-grant-summary')).toContainText('全部工具')
  await expect(page.locator('.admin-grant-summary')).toContainText('无 MCP')
  await page.getByRole('checkbox', { name: '启用学习策略' }).check()
  await expect(page.getByRole('checkbox', { name: /Allow learner uploads|允许学习者上传/ })).toBeVisible()
  const systemTools = page.locator('.admin-system-tools')
  await systemTools.getByRole('button', { name: '自定义' }).click()
  await expect(systemTools.getByRole('checkbox', { name: /web_search/ })).toBeVisible()
  const mcp = page.locator('.admin-mcp-tools')
  await mcp.getByRole('button', { name: '自定义' }).click()
  await mcp.getByRole('checkbox', { name: /mcp/ }).check()
  await expect(page.locator('.admin-grant-footer')).toContainText('有未保存的更改')
  await page.locator('.admin-grant-footer').getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.admin-grant-footer')).toContainText('刚刚保存')
})
