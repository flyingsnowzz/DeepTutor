import { expect, test } from '@playwright/test'

test('admin user management restores avatars, roles, selection and segmented presets', async ({ page }) => {
  const users = [
    { id: 'u1', username: 'admin', role: 'admin', preset: 'custom', created_at: '2026-01-01' },
    { id: 'u2', username: 'learner', role: 'user', preset: 'learner', created_at: '2026-01-02' },
  ]
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true, is_super_admin: true, username: 'admin' } }))
  await page.route('**/api/auth/users?*', route => route.fulfill({ json: users }))
  await page.goto('/admin/users')
  await expect(page.locator('.admin-user-row')).toHaveCount(2)
  await expect(page.locator('.admin-user-identity > span:first-child')).toHaveCount(2)
  await expect(page.locator('.admin-role-badge.admin')).toContainText('管理员')
  await expect(page.locator('.admin-preset-label')).toContainText('预设：学习者')
  await expect(page.locator('.admin-toolbar')).toContainText('2 个用户')
  await page.getByRole('searchbox', { name: '搜索用户' }).fill('learner')
  await expect(page.locator('.admin-user-row')).toHaveCount(1)
  await expect(page.locator('.admin-toolbar')).toContainText('1 / 2')
  await page.getByRole('searchbox', { name: '搜索用户' }).fill('')
  await page.getByLabel('选择 learner').check()
  await expect(page.locator('.admin-selection-bar')).toContainText('已选择 1 个用户')
  await page.getByRole('button', { name: '分配权限', exact: true }).click()
  await expect(page.locator('.admin-user-expanded')).toBeVisible()
  await page.getByRole('button', { name: '添加用户', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加用户' })
  await expect(dialog.locator('.admin-preset-options > button')).toHaveCount(3)
  await dialog.getByRole('button', { name: '学习者', exact: true }).click()
  await expect(dialog.locator('.admin-preset-description')).toContainText('仅对话与沉浸式阅读')
  await expect(page.locator('.admin-users-footer')).toContainText('DeepTutor 管理后台 · 用户管理')
})
