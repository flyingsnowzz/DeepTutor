import { expect, test } from '@playwright/test'

test('task board uses the legacy page bar, preferences and empty columns', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/task-board?*', route => route.fulfill({ json: { cards: [], revision: 0, colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' } } }))
  await page.route('**/api/calendar/task-blocks?*', route => route.fulfill({ json: {} }))
  await page.goto('/kanban')
  await expect(page.locator('.kanban-page-bar')).toBeVisible()
  await expect(page.locator('.kanban-working-count')).toHaveText('0 项进行中')
  await expect(page.locator('.kanban-crumb')).toContainText('任务看板')
  await expect(page.locator('.kanban-crumb svg')).toBeVisible()
  await expect(page.locator('.kanban-bar-actions .task-color-picker-trigger svg')).toBeVisible()
  await expect(page.locator('.kanban-archive-toggle svg').first()).toBeVisible()
  await expect(page.locator('.kanban-toolbar')).toHaveCSS('height', '18px')
  await expect(page.locator('.task-create')).toHaveCSS('height', '49.5px')
  await expect(page.locator('.task-create')).toHaveCSS('border-radius', '12px')
  await expect(page.getByLabel('新任务')).toHaveCSS('border-top-width', '0px')
  await expect(page.getByLabel('新任务')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.getByRole('button', { name: '添加', exact: true })).toHaveCSS('height', '35.5px')
  await expect(page.getByRole('button', { name: '添加', exact: true }).locator('svg')).toBeVisible()
  await expect(page.locator('.task-empty svg')).toHaveCount(3)
  await expect(page.locator('.task-column')).toHaveCount(3)
  await expect(page.locator('.task-column').first()).toHaveCSS('min-height', '384px')
  await expect(page.locator('.task-empty').first()).toHaveCSS('min-height', '112px')
  await expect(page.locator('.kanban-bar-actions').getByText('状态颜色')).toBeVisible()
  await expect(page.locator('.kanban-bar-actions').getByRole('button', { name: '显示已归档', exact: true })).toBeVisible()
  await page.locator('.kanban-crumb').click()
  await expect(page.getByRole('menu', { name: '主页' }).getByRole('menuitem')).toHaveCount(4)
  await page.locator('.kanban-menu-dismiss').click()
  await expect(page.locator('.kanban-bar-actions button[aria-label="状态颜色"] svg')).toBeVisible()
  await page.locator('.kanban-bar-actions button[aria-label="状态颜色"]').click()
  const dialog = page.getByRole('dialog', { name: '状态颜色' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '关闭' }).locator('svg')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '重置', exact: true }).locator('svg')).toBeVisible()
  await expect(dialog.locator('.task-color-swatches button')).toHaveCount(12)
  await dialog.getByRole('button', { name: '进行中', exact: true }).click()
  await dialog.getByRole('button', { name: '选择颜色：#4f46e5', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '选择颜色：#4f46e5', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.locator('.kanban-bar-actions button[aria-label="状态颜色"]')).toHaveAttribute('aria-expanded', 'false')
})


test('task cards match the React compact geometry and Lucide actions', async ({ page }) => {
  const today = new Date()
  const due = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  let board: any = {
    cards: [{ id: 't1', title: 'Read chapter 4', note: 'Take notes on eigenvalues and eigenvectors.', status: 'todo', due_date: due, archived: false, created_at: '', updated_at: '', workspace_id: null }],
    revision: 1,
    colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' },
    session_links: [],
  }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/task-board?*', route => route.fulfill({ json: board }))
  await page.route('**/api/task-board/cards/t1?*', async route => {
    const patch = route.request().postDataJSON()
    board = { ...board, cards: board.cards.map((card: any) => ({ ...card, ...patch })) }
    await route.fulfill({ json: board })
  })
  await page.route('**/api/calendar/task-blocks?*', route => route.fulfill({ json: { t1: 2 } }))
  await page.goto('/kanban')

  const card = page.locator('.task-card').first()
  await expect(card).toHaveCSS('padding', '12px 14px')
  expect((await card.boundingBox())?.height).toBe(100)
  const open = card.locator('.task-card-open')
  expect((await open.boundingBox())?.height).toBe(74)
  await expect(card.locator('.task-due')).toHaveText(`截止 ${due}`)
  await expect(card.locator('.task-due')).toHaveCSS('line-height', '17.5px')
  await expect(card.locator('.task-blocks')).toHaveText('已排 2 段')
  expect((await card.locator('.task-card-open p').boundingBox())?.height).toBe(20)

  await card.hover()
  const forward = page.getByRole('button', { name: 'Read chapter 4: 移至 进行中' })
  await expect(forward).toBeVisible()
  await expect(forward.locator('svg')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Read chapter 4: 归档' }).locator('svg')).toBeVisible()
  await forward.click()
  await expect(page.locator('section[aria-label="进行中"]').getByText('Read chapter 4')).toBeVisible()
})
