import { expect, test } from '@playwright/test'

test('notebook home keeps the legacy page bar and recent card without an extra heading', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/documents?*', route => route.fulfill({ json: { documents: [{ id: 'n1', title: 'Draft', preview: '', updated_at: 1, parent_id: null, pinned: false, revision: 1, icon: '' }] } }))
  await page.goto('/co-writer')
  await expect(page.locator('.co-writer-header')).toHaveCSS('height', '52px')
  await expect(page.locator('.co-writer-header h1')).toHaveText('笔记本')
  await expect(page.locator('.co-writer-toolbar')).toContainText('1 页')
  await expect(page.locator('.co-writer-section > h2')).toHaveCount(0)
  await expect(page.locator('.co-writer-header .primary')).toHaveCSS('background-color', 'rgb(242, 242, 242)')
})
