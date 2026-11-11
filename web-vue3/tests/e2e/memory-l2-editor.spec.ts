import { expect, test } from '@playwright/test'

test('an empty L2 document can be edited and saved for the first time', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  let content = ''
  await page.route(/\/api\/memory\/overview(?:\?.*)?$/, route => route.fulfill({ json: { docs: [{ layer: 'L2', key: 'chat', exists: false, updated_at: null, entry_count: 0, backlog: 0 }] } }))
  await page.route(/\/api\/memory\/doc\/L2\/chat\/lines(?:\?.*)?$/, route => route.fulfill({ json: { lines: [] } }))
  await page.route(/\/api\/memory\/doc\/L2\/chat(?!\/lines)(?:\?.*)?$/, async route => {
    if (route.request().method() === 'PUT') content = route.request().postDataJSON().content
    await route.fulfill({ json: { content } })
  })
  await page.route(/\/api\/memory\/snapshot\/[^/?]+(?:\?.*)?$/, route => route.fulfill({ json: { entities: [], pending_changes: [] } }))
  await page.route(/\/api\/settings\/llm-options(?:\?.*)?$/, route => route.fulfill({ json: { active: null, options: [] } }))
  await page.route(/\/api\/memory\/settings(?:\?.*)?$/, route => route.fulfill({ json: { update: { l2_budget: 20, l3_budget: 12 }, audit: { l2_budget: 10, l3_budget: 8 }, dedup: { iterations: 3, auto_after_update: false } } }))

  await page.goto('/memory/l2/chat')
  await expect(page.locator('.memory-document-empty')).toBeVisible()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const editor = page.getByLabel('记忆文档 Markdown')
  await expect(editor).toBeVisible()
  await editor.fill('# First memory')
  await page.getByRole('button', { name: '保存文档', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('文档已保存')
  await expect(editor).toHaveCount(0)
  expect(content).toBe('# First memory')
  await expect(page.locator('.memory-document-content')).toContainText('First memory')
})
