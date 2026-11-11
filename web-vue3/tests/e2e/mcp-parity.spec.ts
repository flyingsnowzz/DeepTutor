import { expect, test } from '@playwright/test'

test('MCP installed view restores scope, tabs and the legacy empty card', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/space/mcp/servers?*', route => route.fulfill({ json: { servers: {}, status: {}, configured_secrets: {}, oauth: {}, rejected: [], deployment: { servers: [] }, limits: { max_servers: 8 } } }))
  await page.goto('/space/mcp')
  await expect(page.locator('.mcp-page-bar')).toContainText('已连接 0 / 8')
  await expect(page.locator('.mcp-scope-panel')).toContainText('账户资源库')
  await expect(page.getByRole('button', { name: '已安装 0' })).toBeVisible()
  await expect(page.getByRole('button', { name: '商店', exact: true })).toBeVisible()
  await expect(page.locator('.mcp-empty')).toContainText('还没有 MCP 服务器')
  await expect(page.locator('.mcp-empty')).toHaveCSS('border-top-style', 'dashed')
  await expect(page.locator('.cli-tabs>button.active')).toHaveCSS('border-bottom-color', 'rgb(13, 13, 13)')
  await expect(page.locator('.mcp-empty>span svg')).toBeVisible()
  await expect(page.locator('.mcp-add-actions .primary')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.mcp-storage-note')).toContainText('保存于')
  await page.locator('.mcp-crumb').click()
  await expect(page.getByRole('menu', { name: '个性化' }).getByRole('menuitem')).toHaveCount(7)
})
