import { expect, test } from '@playwright/test'

test('code preview uses the selected Prism palette and highlights Python tokens', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: false } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow', code_block_theme: 'oneDark', code_block_show_line_numbers: true, code_block_wrap_long_lines: false } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto('/settings/appearance')
  await expect(page.locator('.legacy-theme-preview[data-theme-id="glass"] radialGradient')).toHaveCount(1)
  await expect(page.locator('.legacy-theme-preview[data-theme-id="glass"] rect[fill="url(#glass-theme-preview-shine)"]')).toHaveCount(1)
  await expect(page.locator('.legacy-theme-preview[data-theme-id="dark"] radialGradient')).toHaveCount(0)
  const preview = page.locator('.code-block-preview')
  await expect(preview.locator('.code-block-number')).not.toHaveCount(0)
  await expect(preview.locator('.code-block-content span[style]')).not.toHaveCount(0)
  const before = await preview.evaluate(element => getComputedStyle(element).backgroundColor)
  await page.getByLabel('语法主题').selectOption('prism')
  await expect.poll(() => preview.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(before)
  await page.getByRole('switch', { name: '显示行号' }).click()
  await expect(preview.locator('.code-block-number')).toHaveCount(0)
})
