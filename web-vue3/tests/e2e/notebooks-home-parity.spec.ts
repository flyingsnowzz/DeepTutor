import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({
    json: { enabled: false, authenticated: false, is_admin: false, is_super_admin: false },
  }))
}

test('notebooks empty home and creation dialog match the legacy hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 637, height: 853 })
  await allowWithoutAuth(page)
  await page.route(/\/api\/notebooks(?:\?.*)?$/, route => route.fulfill({ json: { notebooks: [] } }))
  await page.goto('/notebooks')
  const header = page.locator('.notebooks-page-header')
  await expect(header.locator('h1')).toHaveText('收藏夹')
  await expect(header.locator('p')).toHaveCount(0)
  await expect(header.locator('.notebooks-page-icon')).toBeVisible()
  await expect(page.locator('.notebooks-page-bar')).toBeHidden()
  await expect(page.locator('.notebooks-home-tools')).toHaveCount(0)
  await expect(page.locator('.notebooks-empty')).toContainText('在 DeepTutor 任何地方收藏对话、研究报告或题目，都可以归档到这里的收藏夹。')
  await expect(page.locator('.notebooks-empty')).toHaveCSS('border-top-width', '0px')
  await expect(page.locator('.notebooks-empty-title')).toHaveText('还没有收藏夹。')
  await header.getByRole('button', { name: '创建', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建收藏夹' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('radiogroup', { name: '颜色' }).getByRole('radio')).toHaveCount(9)
  await dialog.getByRole('textbox', { name: '新收藏夹名称' }).fill('考试复习')
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeEnabled()
})

test('notebooks library only shows search and a new card when collections exist', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route(/\/api\/notebooks(?:\?.*)?$/, route => route.fulfill({ json: { notebooks: [
    { id: 'n1', name: 'Research', description: 'Sources', color: '#6366F1', record_count: 0, updated_at: 0 },
  ] } }))
  await page.route(/\/api\/notebooks\/n1(?:\?.*)?$/, route => route.fulfill({ json: {
    id: 'n1', name: 'Research', description: 'Sources', color: '#6366F1', record_count: 0, records: [],
  } }))
  await page.goto('/notebooks')
  await expect(page.getByRole('searchbox', { name: '搜索收藏夹' })).toBeVisible()
  await expect(page.locator('.notebooks-home-tools')).toContainText('1 个收藏夹 · 0 条记录')
  await expect(page.locator('.notebook-collection-card')).toHaveCount(1)
  await expect(page.locator('.notebook-new-card')).toBeVisible()
  await expect(page.locator('.notebooks-page-bar')).toBeVisible()
  await expect(page.locator('.notebooks-page-header .notebooks-page-icon')).toBeHidden()
  await page.locator('.notebooks-crumb').click()
  await expect(page.getByRole('menu', { name: '资料' }).getByRole('menuitem')).toHaveCount(6)
  await page.keyboard.press('Escape')
  await page.getByRole('searchbox', { name: '搜索收藏夹' }).fill('missing')
  await expect(page.locator('.notebooks-empty-title')).toHaveText('没有匹配的收藏夹')
  await expect(page.locator('.notebooks-empty').getByRole('button')).toHaveCount(0)
})
