import { expect, test } from '@playwright/test'

const now = Math.floor(Date.now() / 1000)

function archivedSessions() {
  return [
    {
      id: 'c1', session_id: 'c1', title: 'Archived chat', created_at: now - 7200, updated_at: now - 3600,
      preferences: { archived: true, session_kind: 'chat' },
    },
    {
      id: 'm1', session_id: 'm1', title: 'Matrix review', created_at: now - 90000, updated_at: now - 86400,
      preferences: { archived: true, workspace_mode: 'mastery_path', mastery_path_id: 'p1' },
    },
    {
      id: 'r1', session_id: 'r1', title: 'Reading notes', created_at: now - 180000, updated_at: now - 172800,
      preferences: { archived: true, workspace_mode: 'immersive_reading', reading_workspace_id: 'w1' },
    },
    {
      id: 'child', session_id: 'child', title: 'Tutor child', created_at: now - 7000, updated_at: now - 3000,
      preferences: { archived: true, parent_session_id: 'c1', session_kind: 'selection_tutor' },
    },
  ] as Array<any>
}

async function mockArchive(page: import('@playwright/test').Page, sessions: Array<any>) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/task-board*', route => route.fulfill({ json: { cards: [], colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [] } }))
  await page.route('**/api/mastery-paths/topics/index*', route => route.fulfill({ json: { topics: [{ path_id: 'p1', name: 'Linear Algebra', emoji: '∑' }] } }))
  await page.route('**/api/reading/workspaces/index*', route => route.fulfill({ json: { collections: [{ workspace_id: 'w1', title: 'Physics Papers' }] } }))
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions } }))
}

test('archived conversations keep the React groups and restore quietly in place', async ({ page }) => {
  const sessions = archivedSessions()
  const restores: any[] = []
  let releaseRestore!: () => void
  const restoreGate = new Promise<void>(resolve => { releaseRestore = resolve })
  await mockArchive(page, sessions)
  await page.route('**/api/sessions/c1/organization?*', async route => {
    const body = route.request().postDataJSON()
    restores.push(body)
    await restoreGate
    const target = sessions.find(row => row.session_id === 'c1')
    target.preferences.archived = false
    await route.fulfill({ json: { session: target } })
  })
  await page.goto('/space/chat-history?archive=archived')

  await expect(page.locator('.history-archive-row')).toHaveCount(3)
  await expect(page.locator('.history-archive-group h2')).toHaveText(['聊天1', '精通之路1', '沉浸式阅读1'])
  await expect(page.locator('.history-archive-meta')).toHaveText(['1小时前', 'Linear Algebra · 昨天', 'Physics Papers · 前天'])
  await expect(page.getByText('Tutor child')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '取消归档' })).toHaveCount(3)
  await expect(page.getByRole('button', { name: /删除/ })).toHaveCount(0)
  await expect(page.locator('.history-archive-group').first()).toHaveCSS('margin-top', '20px')
  await expect(page.locator('.history-archive-partition').first()).toHaveCSS('padding', '0px 12px')
  await expect(page.locator('.history-archive-partition').first()).toHaveCSS('border-radius', '12px')
  await expect(page.locator('.history-archive-restore').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const firstRow = await page.locator('.history-archive-row').first().boundingBox()
  expect(firstRow?.height).toBe(58.75)

  await page.getByRole('button', { name: '取消归档' }).first().click()
  await expect.poll(() => restores).toHaveLength(1)
  await expect(page.locator('.history-spinner')).toBeVisible()
  await expect(page.locator('.history-skeleton')).toHaveCount(0)
  await expect(page.locator('.history-archive-row')).toHaveCount(3)
  releaseRestore()
  await expect.poll(() => restores).toEqual([{ archived: false }])
  await expect(page.locator('.history-archive-row')).toHaveCount(3)
  await expect(page.getByText('Archived chat')).toHaveCount(0)
  await expect(page.getByText('Tutor child')).toBeVisible()
  await expect(page.getByText('Matrix review')).toBeVisible()
})

test('archive empty state uses the React copy and spacing', async ({ page }) => {
  await mockArchive(page, [])
  await page.goto('/space/chat-history?archive=archived')
  const empty = page.locator('.history-archive-empty')
  await expect(empty).toHaveText('还没有归档任何对话。')
  await expect(empty).toHaveCSS('padding', '24px 8px')
  await expect(empty).toHaveCSS('font-size', '12.5px')
  await expect(empty).toHaveCSS('text-align', 'center')
})
