import { expect, test } from '@playwright/test'

async function mockConversation(page: import('@playwright/test').Page) {
  let board = { cards: [{ id: 't1', title: 'Linked task', note: 'Task note', status: 'todo', archived: false }, { id: 't2', title: 'Workspace task', status: 'doing', archived: false }], colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [{ workspace_id: '', session_id: 'viewer-session', task_ids: ['t1'], status_link_enabled: true }] }
  const second = { id: 'viewer-two', title: 'Second viewer', content_workspace_id: '', preferences: {}, messages: [] }
  const session = {
    id: 'viewer-session', title: 'Viewer session', content_workspace_id: '', preferences: {},
    messages: [
      { id: 1, role: 'user', content: 'Read this', attachments: [{ id: 'a1', type: 'file', filename: 'notes.txt', mime_type: 'text/plain', url: '/files/notes.txt', size_bytes: 1024, extracted_text: 'Viewer attachment body' }] },
      { id: 2, role: 'assistant', content: 'Done', events: [{ type: 'tool.web_search', content: 'Searched the web' }] },
    ],
  }
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [session, second] } })
    if (path === '/api/sessions/viewer-session') return route.fulfill({ json: session })
    if (path === '/api/sessions/viewer-two') return route.fulfill({ json: second })
    if (path === '/api/task-board') return route.fulfill({ json: board })
    if (path === '/api/task-board/sessions/viewer-session') {
      const body = route.request().postDataJSON() as { task_ids: string[] }
      board = { ...board, session_links: [{ ...board.session_links[0], task_ids: body.task_ids }] }
      return route.fulfill({ json: board })
    }
    if (path === '/api/task-board/cards/t1') {
      const body = route.request().postDataJSON() as { status: string }
      board = { ...board, cards: board.cards.map(card => card.id === 't1' ? { ...card, status: body.status } : card) }
      return route.fulfill({ json: board })
    }
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [{ id: 'chat', available: true }] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    return route.fulfill({ json: {} })
  })
  return { getBoard: () => board }
}

test('viewer matches legacy width, tabs, resizing, previews and persistence', async ({ page }) => {
  const state = await mockConversation(page)
  await page.goto('/chat/viewer-session')
  const panel = page.getByRole('dialog', { name: '会话活动与预览' })
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: '活动', exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(panel).toHaveCSS('width', '520px')
  await expect(panel).toContainText('工具使用')
  await expect(panel).toContainText('web_search')
  await expect(panel.getByRole('heading', { name: '关联任务', exact: true })).toBeVisible()
  await expect(panel.getByRole('heading', { name: '工作区任务', exact: true })).toBeVisible()
  await expect(panel).toContainText('Linked task')
  await expect(panel).toContainText('Workspace task')
  await panel.getByRole('combobox', { name: 'Linked task: 状态' }).selectOption('done')
  await expect.poll(() => state.getBoard().cards.find(card => card.id === 't1')?.status).toBe('done')
  await panel.getByRole('button', { name: 'Linked task: 取消关联' }).click()
  await expect.poll(() => state.getBoard().session_links[0].task_ids).toEqual([])

  const resize = page.getByRole('separator', { name: '调整预览面板宽度' })
  await resize.focus()
  await resize.press('ArrowLeft')
  await expect(panel).toHaveCSS('width', '536px')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dt:viewer-width'))).toBe('536')

  await panel.locator('.dt-viewer-attachment').click()
  await expect(panel.locator('pre')).toHaveText('Viewer attachment body')
  await expect(page.getByRole('link', { name: '下载文件', exact: true })).toHaveAttribute('href', /\/files\/notes\.txt/)
  await page.getByRole('button', { name: '关闭标签页', exact: true }).click()
  await expect(panel.getByRole('heading', { name: '会话活动' })).toBeVisible()

  await page.getByRole('button', { name: '笔记', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown 笔记' })).toBeVisible()
  await page.locator('.conversation-actions').getByRole('button', { name: '活动', exact: true }).click()
  await expect(panel).toBeHidden()
  await page.locator('.conversation-actions').getByRole('button', { name: '活动', exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Markdown 笔记' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Markdown 笔记' }).fill('# Saved note')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('deeptutor.chat.note.viewer-session'))).toBe('# Saved note')
  await page.locator('.chat-session-switcher > button').click()
  await page.getByRole('menuitem', { name: /Second viewer/ }).click()
  await expect(page).toHaveURL(/\/chat\/viewer-two/)
  await expect(page.getByRole('textbox', { name: 'Markdown 笔记' })).toHaveCount(0)
  await page.locator('.chat-session-switcher > button').click()
  await page.getByRole('menuitem', { name: /Viewer session/ }).click()
  await expect(page).toHaveURL(/\/chat\/viewer-session/)
  await expect(page.getByRole('textbox', { name: 'Markdown 笔记' })).toHaveValue('# Saved note')
  await page.getByRole('button', { name: '关闭标签页', exact: true }).click()

  await page.getByRole('button', { name: '新建标签页', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '打开网址' })).toBeVisible()
  await page.getByRole('textbox', { name: '打开网址' }).fill('example.com')
  await page.getByRole('button', { name: '前往网址' }).click()
  await expect(panel.locator('iframe')).toHaveAttribute('src', 'https://example.com')

  await panel.press('Escape')
  await expect(panel).toBeHidden()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dt:chat:viewer-panel'))).toBe('0')
  await page.reload()
  await page.getByRole('button', { name: '活动', exact: true }).click()
  await expect(panel).toHaveCSS('width', '536px')
})
