import { expect, test } from '@playwright/test'

test('agent hub uses the legacy page bar and imported empty state', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/subagents/detect?*', route => route.fulfill({ json: { backends: [{ kind: 'claude_code', display_name: 'Claude Code', available: true, version: '1', detail: '' }] } }))
  await page.route('**/api/subagents/connections?*', route => route.fulfill({ json: { connections: [] } }))
  await page.route('**/api/imports/chat-history?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.goto('/agents')
  await expect(page.locator('.agents-page-bar')).toBeVisible()
  await expect(page.locator('.agents-bar-action')).toContainText('连接智能体')
  await expect(page.locator('.agents-import-empty')).toHaveCSS('min-height', '300px')
  await expect(page.locator('.agents-import-icon')).toBeVisible()
  await expect(page.locator('.agents-import-empty .primary')).toHaveCSS('background-color', 'rgb(13, 13, 13)')
  await expect(page.locator('.agents-import')).toContainText('导入的对话')
  await expect(page.locator('.agents-import-empty')).toContainText('导入 ChatGPT 数据导出，或添加 Claude Code、Codex 文件夹，然后打开任意对话并在 DeepTutor 中继续。')
  await expect(page.locator('.agents-import-empty .primary')).toHaveText('导入对话')
  await page.locator('.agents-crumb').click()
  await expect(page.getByRole('menu', { name: '个性化' }).getByRole('menuitem')).toHaveCount(7)
})
