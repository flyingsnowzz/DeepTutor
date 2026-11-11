import { expect, test } from '@playwright/test'

const adminStatus = { enabled: true, authenticated: true, is_admin: true, is_super_admin: true, username: 'root' }

test('administrator accounts use the legacy back link, list and create form', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: adminStatus }))
  await page.route('**/api/auth/admin/accounts?*', route => route.fulfill({ json: { administrators: [{ id: 'a1', username: 'root', super_admin: true }, { id: 'a2', username: 'admin2', super_admin: false }] } }))
  await page.goto('/admin/accounts')
  await expect(page.locator('.admin-header')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '← 返回' })).toHaveAttribute('href', '/admin/users')
  await expect(page.locator('.admin-account-list .record-row')).toHaveCount(2)
  await expect(page.locator('.admin-account-list')).toContainText('超级管理员')
  await expect(page.getByPlaceholder('邮箱或用户名')).toBeVisible()
  await expect(page.getByRole('button', { name: '创建管理员', exact: true })).toBeVisible()
})

test('user import reports every created and failed row inside the legacy dialog', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: adminStatus }))
  await page.route('**/api/auth/users?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/auth/users/import?*', route => route.fulfill({ json: { created_count: 1, failed_count: 1, results: [
    { row: 2, username: 'new-user', ok: true },
    { row: 3, username: 'duplicate', ok: false, error: '用户名已存在' },
  ] } }))
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /导入用户/ }).click()
  await page.getByLabel('选择 CSV 文件').setInputFiles({ name: 'users.csv', mimeType: 'text/csv', buffer: Buffer.from('username,password,preset\nnew-user,long-enough,standard') })
  await page.getByRole('button', { name: '导入', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导入用户' })
  await expect(dialog).toContainText('成功 1，失败 1')
  await expect(dialog.locator('.admin-import-errors li')).toHaveCount(2)
  await expect(dialog.locator('.admin-import-errors .ok')).toHaveText('已创建')
  await expect(dialog.locator('.admin-import-errors')).toContainText('用户名已存在')
})
