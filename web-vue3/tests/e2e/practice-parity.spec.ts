import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

test('practice home uses the legacy review summary and import preview workflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await allowWithoutAuth(page)
  await page.route('**/api/question-notebook/practice/summary?*', route => route.fulfill({ json: { total: 4, mistakes: 1, due: 2, overdue: 0, reviewed_today: 1, next_due_at: null } }))
  await page.route('**/api/question-notebook/practice/import/preview?*', async route => {
    expect(route.request().postDataBuffer()?.toString()).toContain('questions.csv')
    return route.fulfill({ json: { token: 'preview1', total: 2, valid: 2, errors: [], samples: [{ question: 'What is a vector?', correct_answer: 'Direction', tags: ['math'] }] } })
  })
  await page.route('**/api/question-notebook/practice/import/commit?*', route => route.fulfill({ json: { created: 2, duplicates: 1 } }))
  await page.goto('/learning/practice')
  await expect(page.locator('.practice-page-bar')).toContainText('练习')
  await expect(page.locator('.practice-page > .practice-header')).toHaveCount(0)
  await expect(page.locator('.practice-summary')).toContainText('2')
  await expect(page.locator('.practice-stats')).toContainText('今日已复习')
  await expect(page.locator('.practice-stats')).toContainText('等待下次复习')
  await expect(page.locator('.practice-stats')).toContainText('题库')
  await expect(page.locator('.practice-summary').boundingBox()).resolves.toMatchObject({ x: 308, y: 60, width: 1096 })
  await page.getByRole('button', { name: '导入题目' }).click()
  await expect(page.locator('.practice-import')).toBeVisible()
  await page.locator('.practice-import-file input').setInputFiles({ name: 'questions.csv', mimeType: 'text/csv', buffer: Buffer.from('question,answer\nWhat is a vector?,Direction\n') })
  await expect(page.locator('.practice-import')).toContainText('2 / 2 行有效')
  await expect(page.locator('.practice-import')).toContainText('What is a vector?')
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.locator('.practice-import')).toHaveCount(0)
  await expect(page.locator('.notice')).toContainText('已导入 2 道题，跳过 1 道重复题')
})
