import { expect, test } from '@playwright/test'

test('knowledge file workspace uses an overlay drawer on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const kb = { name: 'account:kb:demo', status: 'ready', metadata: { rag_provider: 'llamaindex' }, statistics: {} }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [kb] }))
  await page.route('**/api/knowledge-bases/account%3Akb%3Ademo?*', route => route.fulfill({ json: kb }))
  await page.route('**/api/knowledge-bases/account%3Akb%3Ademo/progress?*', route => route.fulfill({ json: { stage: 'completed', percent: 100 } }))
  await page.route('**/api/knowledge-bases/account%3Akb%3Ademo/files?*', route => route.fulfill({ json: { files: [{ name: 'docs/guide.txt', type: 'file', mime_type: 'text/plain', size: 12 }] } }))
  await page.route('**/api/knowledge-bases/account%3Akb%3Ademo/file-preview-text/docs%2Fguide.txt?*', route => route.fulfill({ json: { text: 'Preview text' } }))
  await page.goto('/knowledge-bases/account%3Akb%3Ademo')
  const tree = page.locator('.kb-file-tree')
  await expect(tree).not.toBeVisible()
  await page.getByRole('button', { name: '打开文件列表' }).first().click()
  await expect(tree).toHaveClass(/mobile-open/)
  await expect(tree).toBeVisible()
  await tree.locator('.kb-tree-file').first().click()
  await expect(tree).not.toHaveClass(/mobile-open/)
  await expect(page.locator('.kb-file-preview-pane')).toBeVisible()
})
