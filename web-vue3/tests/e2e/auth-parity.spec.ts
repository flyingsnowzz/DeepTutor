import { expect, test } from '@playwright/test'

async function mockLoggedOut(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: false, is_admin: false } }))
}

test('registration restores password guidance, confirmation and success navigation', async ({ page }) => {
  await mockLoggedOut(page)
  await page.route('**/api/auth/register?*', route => route.fulfill({ json: { ok: true } }))
  await page.goto('/register')
  await expect(page.locator('.auth-brand')).toContainText('创建你的账户')
  await expect(page.locator('.auth-password-hint')).toHaveText('至少 8 个字符')
  await page.getByLabel('邮箱或用户名').fill('new-user')
  await page.locator('#password').fill('long-enough')
  await page.getByLabel('确认密码').fill('different-password')
  await page.getByRole('button', { name: '创建账户', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('两次输入的密码不一致')
  await page.getByLabel('确认密码').fill('long-enough')
  await page.getByRole('button', { name: '创建账户', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?registered=1/)
  await expect(page.getByRole('status')).toContainText('账户创建成功')
})

test('administrator login has clean inputs and enters user management', async ({ page }) => {
  await mockLoggedOut(page)
  await page.route('**/api/auth/admin/login?*', route => route.fulfill({ json: { ok: true } }))
  await page.goto('/admin/login')
  await expect(page.locator('#username')).toHaveAttribute('placeholder', '')
  await expect(page.locator('#password')).toHaveAttribute('placeholder', '')
  await expect(page.locator('.auth-tagline')).toHaveCount(0)
  await page.locator('#username').fill('root')
  await page.locator('#password').fill('long-enough')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/users/)
})
