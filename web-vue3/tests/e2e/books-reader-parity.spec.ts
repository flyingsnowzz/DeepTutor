import { expect, test } from '@playwright/test'

const firstPage = {
  id: 'p1', title: 'Vectors', status: 'ready', order: 1,
  blocks: [{ id: 'block-1', type: 'paragraph', title: 'Vector basics', status: 'ready', payload: { body: 'Vectors have direction and magnitude.' } }],
  learning_objectives: ['Understand vectors'],
}
const secondPage = { ...firstPage, id: 'p2', title: 'Magnitude', order: 2, blocks: [] }

test('book reader restores outline, selection capture, review and keyboard navigation', async ({ page }) => {
  const book = { id: 'b1', title: 'Vector book', description: 'Linear algebra', status: 'ready', revision: 1, page_count: 2, chapter_count: 1, can_edit: false, can_delete: false, reading: { percent: 50, current_page_id: 'p1' } }
  const detail = { book, spine: { chapters: [{ id: 'c1', title: 'Chapter 1', page_ids: ['p1', 'p2'], order: 1 }] }, pages: [firstPage, secondPage], progress: { current_page_id: 'p1', visited_page_ids: ['p1'], bookmarked_page_ids: [] } }
  let captureBody: Record<string, unknown> | null = null
  let reviewBody: Record<string, unknown> | null = null
  const capture = { id: 'cap1', status: 'captured', source_text: 'direction', chapter_title: 'Vectors', updated_at: 2 }

  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/books?*', route => route.fulfill({ json: { books: [book], can_create: true } }))
  await page.route('**/api/books/b1?*', route => route.fulfill({ json: detail }))
  await page.route('**/api/books/b1/pages/p1?*', route => route.fulfill({ json: { page: firstPage } }))
  await page.route('**/api/books/b1/pages/p2?*', route => route.fulfill({ json: { page: secondPage } }))
  await page.route('**/api/books/b1/learning-captures?*', route => route.fulfill({ json: { captures: [] } }))
  await page.route('**/api/books/b1/learning-captures?*', route => {
    if (route.request().method() === 'POST') {
      captureBody = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { capture } })
    }
    return route.fulfill({ json: { captures: [] } })
  })
  await page.route('**/api/books/b1/learning-captures/cap1?*', route => {
    if (route.request().method() === 'PATCH') {
      reviewBody = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { capture: { ...capture, status: 'approved', updated_at: 3 } } })
    }
    return route.fulfill({ json: { captures: [] } })
  })

  await page.goto('/learning/books/b1/pages/p1')
  const outline = page.getByRole('button', { name: '本页内容目录' })
  await expect(outline).toHaveAttribute('aria-expanded', 'false')
  await outline.click()
  await expect(page.getByRole('navigation', { name: '本页内容目录' })).toBeVisible()
  await page.locator('.book-outline-nav li button').first().click()
  await expect(page.locator('.book-outline-nav li button').first()).toHaveClass(/active/)

  await page.locator('.book-block .markdown-body p').first().selectText()
  await page.getByRole('button', { name: '✎ 保存选中内容' }).click()
  await expect.poll(() => captureBody).not.toBeNull()
  expect(captureBody).toMatchObject({ page_id: 'p1', block_id: 'block-1', source_text: 'Vectors have direction and magnitude.', book_title: 'Vector book', chapter_title: 'Vectors' })
  await expect(page.locator('.book-capture-panel')).toContainText('1 条待确认')
  await page.getByRole('button', { name: '✓ 确认', exact: true }).click()
  await expect.poll(() => reviewBody).toEqual({ status: 'approved' })
  await expect(page.locator('.book-capture-panel')).toContainText('没有待确认的高亮')
  await page.locator('.book-capture-panel').getByRole('button', { name: '全部', exact: true }).click()
  await expect(page.locator('.book-capture-list')).toContainText('direction')

  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/\/learning\/books\/b1\/pages\/p2$/)
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/\/learning\/books\/b1\/pages\/p1$/)
})
