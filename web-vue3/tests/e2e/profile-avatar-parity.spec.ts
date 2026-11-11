import { expect, test } from '@playwright/test'

test('profile avatar icons are Lucide SVGs and admin badge is preserved', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: false } }))
  await page.route('**/api/auth/profile?*', route => route.fulfill({ json: { id: 'u1', username: 'admin', role: 'admin', created_at: '2026-01-01T00:00:00Z', avatar: 'icon:droplet:green' } }))
  await page.goto('/profile')

  const options = page.locator('.avatar-options button')
  await expect(options).toHaveCount(16)
  await expect(options.locator('svg')).toHaveCount(16)
  await expect(options).toHaveText(Array(16).fill(''))
  await expect(page.locator('.profile-avatar-card')).toHaveCSS('height', '294px')
  await expect(page.locator('.profile-account')).toHaveCSS('height', '176px')
  await expect(page.locator('.profile-signout')).toHaveCSS('height', '92px')
  await expect(page.locator('.user-avatar-admin-badge svg')).toBeVisible()
  await expect(page.locator('.user-avatar-admin-badge')).toHaveCSS('background-color', 'rgb(247, 236, 212)')
})
