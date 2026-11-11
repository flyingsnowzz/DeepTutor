import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

test('books empty library and create dialog match the legacy workflow', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/books?*', async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ user_intent: 'Learn vectors', depth: 'deep', language: 'zh', fallback_language: 'zh' })
      return route.fulfill({ json: { book: { id: 'b1', title: 'Vectors', status: 'draft', revision: 1, chapter_count: 0, page_count: 0 } } })
    }
    return route.fulfill({ json: { books: [], can_create: true } })
  })
  await page.route('**/api/books/b1?*', route => route.fulfill({ json: { book: { id: 'b1', title: 'Vectors', status: 'draft', revision: 1, chapter_count: 0, page_count: 0, can_edit: true, can_delete: true }, spine: { chapters: [] }, pages: [], progress: { current_page_id: '', visited_page_ids: [], bookmarked_page_ids: [] } } }))
  await page.goto('/learning/books')
  await expect(page.locator('.books-stats')).toContainText('书籍总数')
  await expect(page.locator('.books-stats')).toContainText('就绪')
  await expect(page.locator('.books-stats')).toContainText('进行中')
  await expect(page.locator('.books-library-title')).toContainText('我的书库')
  await expect(page.locator('.books-library-title')).toContainText('共 0 本，显示 0 本')
  await expect(page.locator('.books-empty')).toContainText('暂无书籍')
  await page.getByRole('button', { name: '新建书籍' }).first().click()
  await expect(page.getByRole('dialog', { name: '新建书籍' })).toBeVisible()
  await page.getByLabel('你想学习什么？').fill('Learn vectors')
  await page.getByLabel('内容深度').selectOption('deep')
  await page.getByRole('button', { name: '开始创建' }).click()
  await expect(page).toHaveURL(/\/learning\/books\/b1$/)
})

test('book cards show legacy progress and require a second delete confirmation', async ({ page }) => {
  await allowWithoutAuth(page)
  const books = [
    { id: 'b1', title: 'Vectors', description: 'Linear algebra', status: 'ready', revision: 1, updated_at: 100, page_count: 8, chapter_count: 2, can_delete: true, reading: { percent: 50, current_page_id: 'p2', visited_pages: 4, total_pages: 8 } },
    { id: 'b2', title: 'Geometry', description: 'Shapes', status: 'compiling', revision: 1, updated_at: 90, page_count: 4, chapter_count: 1, can_delete: true, reading: { percent: 0, current_page_id: '' } },
  ]
  await page.route('**/api/books?*', async route => {
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { deleted: true } })
    return route.fulfill({ json: { books, can_create: true } })
  })
  await page.route('**/api/books/b2?*', async route => {
    if (route.request().method() === 'DELETE') {
      books.splice(1, 1)
      return route.fulfill({ json: { deleted: true } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/learning/books')
  await expect(page.locator('.book-card')).toHaveCount(2)
  await expect(page.locator('.book-card').first()).toContainText('2 章')
  await expect(page.locator('.book-card').first()).toContainText('8 页')
  await expect(page.locator('.book-card').first()).toContainText('已读 50%')
  await expect(page.locator('.book-card').first()).toContainText('开始阅读')
  await expect(page.locator('.book-cover')).toHaveCount(0)
  await page.locator('.book-card').nth(1).getByRole('button', { name: '删除书籍' }).click()
  expect(books).toHaveLength(2)
  await page.locator('.book-card').nth(1).getByRole('button', { name: '再次点击确认删除' }).click()
  await expect(page.locator('.book-card')).toHaveCount(1)
})
