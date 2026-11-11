import { expect, test } from '@playwright/test'

test('admin user management keeps scrollable table and legacy dialog widths on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const users = [
    { id: 'u1', username: 'admin', role: 'admin', preset: 'custom', created_at: '2026-01-01' },
    { id: 'u2', username: 'learner-with-a-long-name', role: 'user', preset: 'learner', created_at: '2026-01-02' },
  ]
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true, is_super_admin: true, username: 'admin' } }))
  await page.route('**/api/auth/users?*', route => route.fulfill({ json: users }))
  await page.goto('/admin/users')
  const card = page.locator('.admin-users-page .record-list')
  await expect(card).toHaveCSS('overflow-x', 'auto')
  await expect(page.locator('.admin-user-row').first()).toBeVisible()
  await page.getByRole('button', { name: '添加用户', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加用户' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeLessThanOrEqual(384)
  await expect(dialog.locator('.admin-preset-options > button')).toHaveCount(3)
  await dialog.getByRole('button', { name: '学习者', exact: true }).click()
  await expect(dialog.locator('.admin-preset-description')).toContainText('仅对话与沉浸式阅读')
})
