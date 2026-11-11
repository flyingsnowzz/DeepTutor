import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

test('learning home uses legacy cards, centered empty state and the learning-way dialog', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/dashboard/learning-index?*', route => route.fulfill({ json: { sources: { books: [], mastery: [], reading: [], watching: [], practice: [] }, failed: [] } }))
  await page.goto('/learning')
  await expect(page.locator('.learning-page-bar')).toContainText('全部学习')
  await expect(page.locator('.learning-page-bar')).toContainText('新建学习')
  await expect(page.locator('.learning-home > .feature-heading')).toHaveCount(0)
  await expect(page.locator('.learning-way-card')).toHaveCount(4)
  await expect(page.locator('.learning-empty')).toContainText('从这里开始新的学习旅程')
  await expect(page.locator('.dt-product-sidebar')).toContainText('学习记录')
  await expect(page.locator('.dt-product-sidebar')).toContainText('新建一项学习，从这里开始。')
  await page.locator('.learning-way-card').first().click()
  await expect(page.getByRole('dialog', { name: '书籍' })).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('正文动笔之前，章节骨架还可以改')
  await expect(page.getByRole('dialog')).toContainText('页面里配有插图、时间线、随堂题和记忆卡')
  await expect(page.locator('.learning-way-scrim')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.3)')
  await page.getByRole('button', { name: '开始' }).click()
  await expect(page).toHaveURL(/\/learning\/books$/)
})

test('learning filters and search retain activity navigation', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/dashboard/learning-index?*', route => route.fulfill({ json: { sources: {
    books: [{ id: 'b1', title: 'Biology', status: 'ready', updated_at: 100 }],
    mastery: [], reading: [], watching: [], practice: [],
  }, failed: [] } }))
  await page.goto('/learning')
  await page.getByRole('button', { name: '书籍', exact: true }).click()
  await expect(page.locator('.learning-record-card')).toContainText('Biology')
  await page.getByRole('textbox', { name: '搜索学习记录' }).fill('missing')
  await expect(page.getByText('没有符合条件的学习记录。')).toBeVisible()
  await page.getByRole('textbox', { name: '搜索学习记录' }).fill('bio')
  await expect(page.locator('.learning-record-card')).toContainText('Biology')
})

test('new learning uses two-column surface cards and persists hidden features in the customize dialog', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/modules?*', route => route.fulfill({ json: { modules: [] } }))
  let customization = { chat: { hidden_modes: [], controls: { skills: true, mcp: true, partners: true, preferences: true, voice: true }, starters: {} }, learning: { hidden_features: [] as string[] } }
  await page.route('**/api/settings/page-customization?*', route => route.fulfill({ json: customization }))
  await page.route('**/api/settings/page-customization/learning?*', async route => {
    const body = route.request().postDataJSON() as { hidden_features: string[] }
    customization = { ...customization, learning: { hidden_features: body.hidden_features } }
    return route.fulfill({ json: customization })
  })
  await page.goto('/learning/new')
  await expect(page.locator('.new-learning-card')).toHaveCount(4)
  await expect(page.locator('.new-learning-page-bar')).toContainText('新建学习')
  await expect(page.locator('.new-learning-page-bar')).toContainText('自定义页面')
  await expect(page.locator('.new-learning-footer')).toContainText('自定义设置会保存到你的账户')
  await page.getByRole('button', { name: '自定义页面', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '自定义页面' })).toBeVisible()
  await page.getByRole('switch', { name: /书籍/ }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(customization.learning.hidden_features).toEqual(['books'])
  await expect(page.locator('.new-learning-card')).toHaveCount(3)
  await expect(page.locator('.new-learning-card').filter({ hasText: '书籍' })).toHaveCount(0)
  await page.getByRole('button', { name: '自定义页面', exact: true }).click()
  await page.getByRole('button', { name: '恢复默认' }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.new-learning-card')).toHaveCount(4)
})

test('learning navigation files study sessions under records with React ordering, disclosure and bounded controls', async ({ page }) => {
  await allowWithoutAuth(page)
  const now = Math.floor(Date.now() / 1000)
  const source = (pathId: string, title: string, updatedAt: number, createdAt: number) => ({
    path_id: pathId,
    name: title,
    metadata: { goal: title, status: 'active', created_at: createdAt },
    map: { counts: { total: 0, mastered: 0 } },
    updated_at: updatedAt,
    content_workspace_id: '',
  })
  const session = (sessionId: string, title: string, pathId: string, updatedAt: number, createdAt: number) => ({
    id: sessionId,
    session_id: sessionId,
    title,
    updated_at: updatedAt,
    created_at: createdAt,
    content_workspace_id: '',
    preferences: { workspace_mode: 'mastery_path', mastery_path_id: pathId, workspace_id: '', archived: false },
    status: 'succeeded',
  })
  await page.route('**/api/dashboard/learning-index?*', route => route.fulfill({ json: { sources: {
    books: [],
    mastery: [source('m1', 'unified_first_path', now - 1000, now - 2000), source('m2', 'Second path', now - 3000, now - 50)],
    reading: [], watching: [], practice: [],
  }, failed: [] } }))
  await page.route('**/api/sessions?limit=200*', route => route.fulfill({ json: { sessions: [
    session('s1', 'Meaningful mastery conversation', 'm1', now - 500, now - 1500),
    session('s2', 'New conversation', 'm2', now - 4000, now - 40),
  ] } }))

  await page.goto('/learning/new')
  const navigation = page.locator('.dt-learning-navigation')
  const overview = navigation.locator('.dt-overview-row')
  await expect(overview.nth(0)).toContainText('新建学习')
  await expect(overview.nth(1)).toContainText('全部学习')
  await expect(navigation.locator('.dt-record-node')).toHaveCount(2)
  const first = navigation.locator('.dt-record-node').first()
  await expect(first).toContainText('unified_first_path')
  await expect(first.locator('.dt-record-chat-count')).toContainText('1')
  await expect(first).not.toContainText('Meaningful mastery conversation')

  const navBox = await navigation.boundingBox()
  const actionsBox = await navigation.locator('.dt-navigation-actions').boundingBox()
  const timeBox = await first.locator('.dt-record-time').boundingBox()
  expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width)
  expect(timeBox!.x + timeBox!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width)

  await first.locator('.dt-record-toggle').click()
  await expect(first.locator('.dt-record-children')).toContainText('Meaningful mastery conversation')
  await expect(first.locator('.dt-record-toggle')).toHaveAttribute('aria-expanded', 'true')
  await first.locator('.dt-record-toggle').click()
  await expect(first.locator('.dt-record-children')).toHaveCount(0)

  await navigation.getByRole('button', { name: '搜索学习记录' }).click()
  await navigation.getByRole('searchbox', { name: '搜索学习记录' }).fill('meaningful')
  await expect(navigation.locator('.dt-record-node')).toHaveCount(1)
  await expect(navigation.locator('.dt-record-children')).toContainText('Meaningful mastery conversation')
  await navigation.getByRole('button', { name: '清除搜索' }).click()

  await navigation.getByRole('button', { name: '排序方式' }).click()
  await navigation.getByRole('menuitemradio', { name: '创建时间' }).click()
  await expect(navigation.locator('.dt-record-node').first()).toContainText('Second path')
})
