import { expect, test, type Page } from '@playwright/test'

test('knowledge home keeps the legacy tab and empty state without an extra heading', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/knowledge-bases/rag-providers?*', route => route.fulfill({ json: { providers: [] } }))
  await page.goto('/knowledge-bases')
  await expect(page.locator('.knowledge-home-bar')).toContainText('知识中心')
  await expect(page.locator('.knowledge-home-bar')).toHaveCSS('height', '52px')
  await expect(page.locator('.knowledge-home-bar > .primary')).toHaveCSS('background-color', 'rgb(242, 242, 242)')
  await expect(page.locator('.knowledge-home-heading')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /知识引擎/ })).toBeVisible()
  await expect(page.locator('.knowledge-home-empty')).toContainText('暂无知识库')
  await expect(page.locator('.knowledge-home-empty')).toContainText('创建一个知识库，上传文档，在对话中检索有依据的内容。')
})
