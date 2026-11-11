import { expect, test } from '@playwright/test'

test('CLI apps stay within a narrow viewport across installed and store tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/space/cli-apps/apps*', route => route.fulfill({ json: { apps: [], access: { exec_denied: false } } }))
  await page.route('**/api/space/cli-apps/catalog*', route => route.fulfill({ json: { entries: [], categories: {}, next_cursor: '', total: 0 } }))
  await page.goto('/space/cli-apps')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: '搜索应用' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('MCP page and add-by-url editor fit narrow viewports', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/space/mcp/servers*', route => route.fulfill({ json: { servers: {}, status: {}, configured_secrets: {}, oauth: {}, rejected: [], deployment: { servers: [] }, limits: { max_servers: 8 } } }))
  await page.goto('/space/mcp')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '添加远程服务' }).click()
  const editor = page.locator('.mcp-editor')
  await expect(editor).toBeVisible()
  const box = await editor.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeLessThanOrEqual(342)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
