import { expect, test } from '@playwright/test'

const VIEWPORT = { width: 390, height: 844 } as const
const LONG_TEXT = '这是一个非常非常长且没有空格的连续文本'.repeat(12)
const LONG_TOKEN = 'supercalifragilisticexpialidocious-supercalifragilisticexpialidocious-supercalifragilisticexpialidocious'

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(VIEWPORT.width)
}

async function expectInsideViewport(page: import('@playwright/test').Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORT.width)
}

test.describe('learning workspace mobile parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.route('**/api/auth/status*', route => route.fulfill({
      json: { enabled: false, authenticated: false, is_admin: false },
    }))
  })

  test('learning journal wraps long mission, handoff and records', async ({ page }) => {
    await page.route('**/api/learning-journal*', route => route.fulfill({ json: {
      mission: { topic: LONG_TEXT, why: LONG_TOKEN, level: '高阶', updated_at: '2026-11-10 09:30' },
      last_session: { summary: LONG_TEXT, next_focus: LONG_TOKEN, updated_at: '2026-11-10 10:00' },
      records: [{ id: 'r1', title: LONG_TEXT, insight: LONG_TOKEN, created_at: '2026-11-09 18:20' }],
    } }))

    await page.goto('/space/journal')

    await expect(page.locator('.journal-page-bar')).toBeHidden()
    await expect(page.getByRole('heading', { name: '学习日志', exact: true })).toBeVisible()
    await expectNoPageOverflow(page)
    await expectInsideViewport(page, '.journal-page-content section[aria-label="当前学习目标"]')
    await expectInsideViewport(page, '.journal-page-content section[aria-label="上次会话交接"]')
    await expectInsideViewport(page, '.journal-page-content section[aria-label="已确认的学习记录"]')
  })

  test('question bank keeps cards, filters, import panel and selection bar inside a phone', async ({ page }) => {
    const question = {
      id: 1,
      question: LONG_TEXT,
      options: { A: LONG_TOKEN, B: '较短但也需要换行的选项内容' },
      correct_answer: 'A',
      explanation: LONG_TOKEN,
      user_answer: 'B',
      source: 'mastery_path',
      material_id: 'm1',
      material_title: LONG_TOKEN,
      mastery_path_id: 'p1',
      session_id: 's1',
      session_title: LONG_TEXT,
      is_correct: false,
      resolved: false,
      bookmarked: false,
      score_trend: 'improved',
      categories: [{ id: 1, name: LONG_TEXT, entry_count: 1 }],
      created_at: 1,
    }
    await page.route('**/api/question-notebook/entries?*', route => route.fulfill({ json: { items: [question], total: 1 } }))
    await page.route('**/api/question-notebook/categories?*', route => route.fulfill({
      json: [{ id: 1, name: LONG_TEXT, entry_count: 1 }, { id: 2, name: `分类${LONG_TOKEN}`, entry_count: 0 }],
    }))
    await page.route('**/api/question-notebook/stats?*', route => route.fulfill({
      json: { total: 1, wrong: 1, unresolved: 1, bookmarked: 0, uncategorized: 0 },
    }))
    await page.route('**/api/question-notebook/materials?*', route => route.fulfill({
      json: [{ source: 'mastery_path', material_id: 'm1', material_title: LONG_TOKEN, entry_count: 1, unresolved_count: 1 }],
    }))

    await page.goto('/space/questions')

    await expect(page.locator('.question-page-bar')).toBeHidden()
    await expect(page.locator('.question-card')).toBeVisible()
    await expectNoPageOverflow(page)
    await expectInsideViewport(page, '.question-card')
    await expectInsideViewport(page, '.question-toolbar')
    await expectInsideViewport(page, '.question-scope-row')

    await page.locator('.question-card input[type="checkbox"]').check()
    await expect(page.locator('.question-selection')).toBeVisible()
    await expectNoPageOverflow(page)
    await expectInsideViewport(page, '.question-selection')

    await page.getByRole('button', { name: '管理标签' }).click()
    await expect(page.getByRole('textbox', { name: '分类名称' })).toBeVisible()
    await expectNoPageOverflow(page)
    await expectInsideViewport(page, '.question-category-manager')

    await page.locator('.question-page-header .question-import-button').click()
    await expect(page.locator('.practice-import')).toBeVisible()
    await expectNoPageOverflow(page)
    await expectInsideViewport(page, '.practice-import')

    await page.locator('.question-answer summary').click()
    await expect(page.locator('.question-option.is-correct')).toContainText('✓ 正确')
    await expectNoPageOverflow(page)
    await page.locator('.question-card .category-menu-trigger').click()
    await expect(page.locator('.question-card .category-menu-panel')).toBeVisible()
    await expect(page.locator('.question-card .category-menu-item')).toHaveCount(2)
    await expect(page.getByRole('button', { name: '创建并加入' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('.question-card .category-menu-panel')).toBeHidden()
  })

  test('task board keeps columns, edit form and color picker inside a phone', async ({ page }) => {
    const card = {
      id: 't1',
      title: LONG_TEXT,
      note: LONG_TOKEN,
      status: 'todo',
      due_date: '2026-11-11',
      archived: false,
      created_at: '2026-11-10T08:00:00Z',
      updated_at: '2026-11-10T09:00:00Z',
    }
    await page.route('**/api/task-board?*', route => route.fulfill({ json: {
      cards: [card],
      revision: 1,
      colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' },
    } }))
    await page.route('**/api/calendar/task-blocks?*', route => route.fulfill({ json: { t1: 3 } }))

    await page.goto('/kanban')

    await expect(page.locator('.kanban-page-bar')).toBeHidden()
    await expect(page.locator('.task-column')).toHaveCount(3)
    await expectNoPageOverflow(page)
    await expectInsideViewport(page, '.task-column')
    await expectInsideViewport(page, '.task-card')

    await page.locator('.task-card-open').first().click()
    await expect(page.getByRole('textbox', { name: '任务标题' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '任务备注' })).toBeVisible()
    await expectNoPageOverflow(page)
    await expectInsideViewport(page, '.task-card form')

    await page.getByRole('button', { name: '取消' }).click()
    await page.locator('.kanban-preferences button[aria-label="状态颜色"]').click()
    const colorDialog = page.getByRole('dialog', { name: '状态颜色' })
    await expect(colorDialog).toBeVisible()
    await expect(page.locator('.kanban-preferences button[aria-label="状态颜色"]')).toHaveAttribute('aria-expanded', 'true')
    await expectNoPageOverflow(page)
    await expectInsideViewport(page, '.task-color-picker-panel')
  })
})
