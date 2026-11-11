import { expect, test } from '@playwright/test'

const users = [
  { id: 'u1', username: 'admin', role: 'admin', preset: 'custom', created_at: '2026-01-01' },
  { id: 'u2', username: 'learner', role: 'user', preset: 'learner', created_at: '2026-01-02' },
]
const permission = { create: true, default: 'none' as const, books: {} }
let guardianCount = 1

test('expanded assignments keep legacy book, guardian and learner profile sections', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true, is_super_admin: true, username: 'admin' } }))
  await page.route('**/api/auth/users?*', route => route.fulfill({ json: users }))
  await page.route('**/api/multi-user/admin/resources?*', route => route.fulfill({ json: { models: { llm: [] }, knowledge_bases: [], skills: [], partners: [], reading_materials: [], reading_extensions: [], tools: [], mcp_tools: [] } }))
  await page.route('**/api/multi-user/users/u2/grants?*', route => route.fulfill({ json: { grant: { version: 2, user_id: 'u2', models: { llm: [] }, knowledge_bases: [], skills: [], partners: [], enabled_tools: null, mcp_tools: null, exec_enabled: null, learning_policy: null } } }))
  await page.route('**/api/multi-user/admin/books?*', route => route.fulfill({ json: { books: [{ book_id: 'b1', title: 'Book One' }] } }))
  await page.route('**/api/multi-user/users/u2/book-permission?*', route => route.fulfill({ json: { permission } }))
  guardianCount = 1
  await page.route('**/api/multi-user/guardians?*', route => route.fulfill({ json: { relationships: guardianCount ? [{ id: 'g1', guardian_user_id: 'u3', guardian_username: 'parent', learner_user_id: 'u2', permissions: ['view_reports'] }] : [] } }))
  await page.route('**/api/multi-user/learners/u2/guardian-report?*', route => route.fulfill({ json: { assigned_materials: [], grant_summary: { model_count: 0, knowledge_base_count: 0, skill_count: 0 } } }))
  await page.route('**/api/auth/users/learner/learner-profile?*', route => route.fulfill({ json: { learner_profile: {} } }))
  await page.route('**/api/multi-user/guardians/g1?*', route => route.fulfill({ json: {} }))
  await page.goto('/admin/users')
  await page.getByRole('button', { name: '分配权限', exact: true }).click()

  await expect(page.getByRole('heading', { name: '书籍访问' })).toBeVisible()
  await page.getByLabel('Book One 权限').selectOption('read')
  await expect(page.locator('.admin-book-editor .admin-editor-status')).toContainText('有未保存的书籍权限更改')

  await expect(page.getByRole('heading', { name: '监护关系' })).toBeVisible()
  await page.getByRole('button', { name: '撤销访问', exact: true }).click()
  const confirm = page.locator('.admin-confirm-dialog').filter({ hasText: '撤销监护访问' })
  await expect(confirm).toContainText('这将立即移除对该学习者账号的访问。')
  await confirm.getByRole('button', { name: '撤销访问', exact: true }).click()
  await expect(page.locator('.admin-guardian-editor [role="status"]').filter({ hasText: '已撤销监护权限' })).toBeVisible()

  await page.getByLabel('学习者新密码').fill('long-enough')
  await expect(page.getByRole('button', { name: '重置学习者凭据', exact: true })).toBeEnabled()

  await expect(page.getByRole('heading', { name: '学习者档案' })).toBeVisible()
  await page.getByLabel('年龄').fill('12')
  await expect(page.locator('.admin-learner-profile-editor .admin-ghost-save')).toBeVisible()
})
