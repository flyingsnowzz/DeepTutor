import { expect, test, type Page } from '@playwright/test'
import type { NotePage, NoteSummary } from '../../src/notes/noteTypes'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

function summary(document: NotePage): NoteSummary {
  const { content: _content, blocks: _blocks, ...item } = document
  return item
}

async function mockWorkspace(page: Page, documents: Record<string, NotePage>) {
  await page.route('**/api/documents/*?*', route => {
    const match = new URL(route.request().url()).pathname.match(/^\/api\/documents\/([^/]+)$/)
    const document = match ? documents[decodeURIComponent(match[1])] : undefined
    if (!document) return route.fulfill({ status: 404, json: { detail: 'Not found' } })
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Partial<NotePage>
      Object.assign(document, body, { revision: document.revision + 1 })
    }
    return route.fulfill({ json: document })
  })
  await page.route('**/api/documents?*', route => route.fulfill({ json: { documents: Object.values(documents).map(summary) } }))
  await page.route('**/api/documents/*/suggestions?*', route => route.fulfill({ json: { suggestions: [] } }))
  await page.route('**/api/documents/*/threads?*', route => route.fulfill({ json: { threads: [] } }))
  await page.route('**/api/documents/*/backlinks?*', route => route.fulfill({ json: { pages: [] } }))
}

function fixture(id: string, title: string, parent_id: string | null = null): NotePage {
  return {
    id, title, parent_id, icon: '', cover: '', pinned: false, revision: 1, content: '',
    blocks: [{ id: `${id}-p`, type: 'paragraph', props: {}, content: [{ type: 'text', text: `${title} body`, styles: {} }], children: [] }],
  }
}

test('page tree creates nested pages and the breadcrumb switches pages', async ({ page }) => {
  await allowWithoutAuth(page)
  const documents: Record<string, NotePage> = {
    root: { ...fixture('root', 'Root'), icon: '📘' },
    doc1: fixture('doc1', 'Research', 'root'),
    other: fixture('other', 'Other'),
  }
  await mockWorkspace(page, documents)
  let createdParent: string | null | undefined
  await page.route('**/api/documents?*', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { documents: Object.values(documents).map(summary) } })
    const body = route.request().postDataJSON() as { parent_id: string | null }
    createdParent = body.parent_id
    documents['new-page'] = { ...fixture('new-page', ''), parent_id: body.parent_id }
    return route.fulfill({ json: documents['new-page'] })
  })
  await page.goto('/co-writer/doc1')
  await page.getByRole('button', { name: '页面树', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '页面树' })).toBeVisible()
  await expect(page.locator('.dt-note-tree-row.is-current')).toContainText('Research')
  await page.getByRole('button', { name: '在Root内新建页面' }).click()
  await expect(page).toHaveURL(/\/co-writer\/new-page$/)
  expect(createdParent).toBe('root')
  await expect.poll(() => documents['new-page']?.parent_id).toBe('root')

  await page.getByRole('button', { name: '页面树', exact: true }).click()
  await page.goto('/co-writer/doc1')
  await page.locator('.dt-note-current .dt-crumb').click()
  await page.getByRole('menuitem', { name: 'Root', exact: true }).click()
  await expect(page).toHaveURL(/\/co-writer\/root$/)
})

test('page metadata, move menu, Markdown export and outline match the legacy workspace', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.setViewportSize({ width: 1600, height: 900 })
  const research = fixture('doc1', 'Research')
  research.blocks = [
    { id: 'h1', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Chapter one', styles: {} }], children: [] },
    { id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Body', styles: {} }], children: [] },
  ]
  const documents: Record<string, NotePage> = { doc1: research, other: fixture('other', 'Archive') }
  await mockWorkspace(page, documents)
  await page.goto('/co-writer/doc1')
  await expect(page.getByRole('navigation', { name: '本页内容' })).toContainText('Chapter one')

  await page.getByRole('button', { name: '添加图标' }).click()
  await page.getByRole('menuitemradio', { name: '🧠', exact: true }).click()
  await expect.poll(() => research.icon).toBe('🧠')
  await page.getByRole('button', { name: '添加封面' }).click()
  await page.getByRole('menuitemradio').first().click()
  await expect.poll(() => research.cover).toBe('#e6e4dc')

  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '置顶到顶部' }).click()
  await expect.poll(() => research.pinned).toBe(true)
  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '移动到' }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect.poll(() => research.parent_id).toBe('other')

  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '导出 Markdown' }).click()
  expect((await downloaded).suggestedFilename()).toBe('Research.md')
})

test('favorite picker previews and inserts saved originals without losing them on later edits', async ({ page }) => {
  await allowWithoutAuth(page)
  const research = fixture('doc1', 'Research')
  const documents: Record<string, NotePage> = { doc1: research }
  await mockWorkspace(page, documents)
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [{ id: 'n1', name: 'Sources', color: '#6366F1' }] } }))
  await page.route('**/api/notebooks/n1?*', route => route.fulfill({ json: { records: [{ id: 'r1', type: 'research', title: 'Saved finding', summary: 'A concise summary', output: '## Evidence\n\nSaved original text.', created_at: 1 }] } }))
  await page.goto('/co-writer/doc1')
  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '插入收藏' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.locator('.dt-fav-preview')).toContainText('Saved original text.')
  await page.locator('.dt-fav-row-main').click()
  await expect(page.getByLabel('选择 Saved finding')).toBeChecked()
  await page.getByRole('button', { name: '插入', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => research.blocks?.some(block => block.type === 'clip' && block.props.title === 'Saved finding')).toBe(true)
  await expect(page.locator('.dt-note-favorite-title')).toHaveText('Saved finding')
  await page.locator('.rich-note-content p').first().selectText()
  await page.keyboard.type('Edited after inserting favorite')
  await expect.poll(() => research.blocks?.some(block => block.type === 'clip' && block.props.title === 'Saved finding')).toBe(true)
})

test('companion uses the legacy welcome and submits note generation for a selected learning block', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.addInitScript(() => {
    const messages: { type?: string; note_generation?: unknown }[] = []
    ;(window as unknown as { __wsMessages: typeof messages }).__wsMessages = messages
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) {
        const value = JSON.parse(raw) as { type?: string }
        messages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'session_meta', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3; this.onclose?.() }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
  })
  const research = fixture('doc1', 'Research')
  const documents: Record<string, NotePage> = { doc1: research }
  await mockWorkspace(page, documents)
  await page.route('**/api/sessions/s1?*', route => route.fulfill({ json: { id: 's1', title: '生成学习内容', messages: [] } }))
  await page.goto('/co-writer/doc1')
  await page.getByRole('button', { name: '伴读助手', exact: true }).click()
  await expect(page.getByRole('button', { name: '从这里继续写' })).toBeVisible()
  await expect(page.getByText('今天想学什么？')).toBeHidden()
  await expect(page.locator('.dt-note-anchor')).toContainText('Research body')
  await page.getByRole('button', { name: '测一测', exact: true }).click()
  await page.locator('.co-writer-assistant form').getByRole('button', { name: '发送' }).click()
  await expect.poll(() => research.blocks?.some(block => block.type === 'learning' && block.props.kind === 'quiz')).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wsMessages: { type?: string; note_generation?: { kind: string } }[] }).__wsMessages.find(message => message.type === 'start_turn')?.note_generation?.kind)).toBe('quiz')
  const messages = await page.evaluate(() => (window as unknown as { __wsMessages: { type?: string; note_generation?: { block_id: string; kind: string } }[] }).__wsMessages)
  const start = messages.find(message => message.type === 'start_turn')
  expect(start?.note_generation?.kind).toBe('quiz')
  expect(start?.note_generation?.block_id).toBeTruthy()
})

test('co-writer empty home matches the React borderless state and copy', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/documents?*', route => route.fulfill({ json: { documents: [] } }))
  await page.goto('/co-writer')
  const empty = page.locator('.co-writer-empty')
  await expect(empty).toHaveCSS('border-top-width', '0px')
  const emptyBox = await empty.boundingBox()
  expect(emptyBox!.height).toBeCloseTo(342.1, 0)
  expect(emptyBox!.x).toBe(308)
  expect(emptyBox!.y).toBe(60)
  await expect(empty).toContainText('为一个主题、一节课或一篇论文开一页。Dito 可以帮你写，也能把它变成练习。')
  await expect(page.locator('.co-writer-header h1 svg')).toBeVisible()
  await expect(empty.locator('button').first()).toHaveCSS('height', '36px')
})

test('rich editor toolbar matches the legacy actions and preserves inserted blocks', async ({ page }) => {
  await allowWithoutAuth(page)
  const research = fixture('doc1', 'Research')
  const documents: Record<string, NotePage> = { doc1: research }
  await mockWorkspace(page, documents)
  await page.goto('/co-writer/doc1')
  await page.locator('.rich-note-editor').hover()
  const toolbar = page.locator('.rich-note-toolbar')
  const labels = await toolbar.locator('.rich-note-toolbar-main button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
  expect(labels).toEqual([
    '撤销', '重做', '一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题',
    '粗体', '斜体', '删除线', '行内代码', '引用', '项目列表', '编号列表', '任务列表',
    '水平分割线', '表格', '链接', '图片', '代码块', 'Mermaid 图表', '数学块',
  ])
  await toolbar.getByRole('button', { name: '四级标题' }).click()
  await toolbar.getByRole('button', { name: '表格' }).click()
  await toolbar.getByRole('button', { name: '图片' }).click()
  await toolbar.getByRole('button', { name: 'Mermaid 图表' }).click()
  await toolbar.getByRole('button', { name: '数学块' }).click()
  await expect.poll(() => research.blocks?.some(block => block.type === 'heading' && block.props.level === 4)).toBe(true)
  await expect.poll(() => research.blocks?.some(block => block.type === 'table')).toBe(true)
  await expect.poll(() => research.blocks?.some(block => block.type === 'image')).toBe(true)
  await expect.poll(() => research.blocks?.some(block => block.type === 'mermaid')).toBe(true)
  await expect.poll(() => research.blocks?.some(block => block.type === 'math')).toBe(true)
  await expect(page.locator('.co-writer-preview-content')).toContainText('Research body')
  const sync = page.getByRole('button', { name: '同步滚动' })
  await sync.click()
  await expect(sync).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('deeptutor.co_writer.sync_scroll.v2'))).toBe('0')
  await page.getByRole('button', { name: '收起预览' }).click()
  await expect(page.locator('.co-writer-preview-pane')).toHaveCount(0)
  await expect(sync).toBeDisabled()
  await page.getByRole('button', { name: '展开预览' }).click()
  await expect(page.locator('.co-writer-preview-pane')).toBeVisible()
  await page.getByRole('button', { name: '收起编辑' }).click()
  await expect(page.locator('.co-writer-editor-pane')).toHaveCount(0)
  await page.getByRole('button', { name: '展开编辑' }).click()
  await expect(page.locator('.co-writer-editor-pane')).toBeVisible()
  const separator = page.getByRole('separator', { name: '调整编辑和预览宽度' })
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '55')
  await page.keyboard.press('Home')
  await expect(separator).toHaveAttribute('aria-valuenow', '50')
})
