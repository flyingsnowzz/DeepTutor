import { expect, test } from '@playwright/test'

for (const path of ['/login', '/register', '/admin/login']) {
  test(`${path} fits the narrow viewport without overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: false, is_admin: false } }))
    await page.goto(path)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(360)
    const card = page.locator('.auth-card')
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeLessThanOrEqual(328)
    await expect(page.locator('.auth-page')).toBeVisible()
  })
}
