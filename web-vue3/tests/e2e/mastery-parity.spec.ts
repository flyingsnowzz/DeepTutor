import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

test('mastery index and creation wizard match the legacy two-step workflow', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/mastery-paths/topics?*', route => route.fulfill({ json: { topics: [] } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [{ name: 'kb1' }] }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [{ id: 'n1', name: 'Notes' }] } }))
  await page.route('**/api/knowledge-bases/kb1/files?*', route => route.fulfill({ json: { files: [{ name: 'chapter.pdf', type: 'file' }, { name: 'assets', type: 'folder' }] } }))
  await page.goto('/learning/mastery')
  await expect(page.locator('.mastery-page-bar')).toContainText('精通之路')
  await expect(page.locator('.mastery-page-bar')).toContainText('新建精通目标')
  await expect(page.locator('.mastery-index-page > .feature-heading')).toHaveCount(0)
  await expect(page.locator('.mastery-empty-map')).toContainText('地图仍是一张空白纸')
  await page.getByRole('button', { name: '绘制第一张地图' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.mastery-wizard-emblems button')).toHaveCount(8)
  await page.getByLabel('学习目标').fill('Learn linear algebra')
  await page.getByRole('button', { name: '选择目标徽记 大脑' }).click()
  await page.locator('.mastery-wizard-footer').getByRole('button', { name: '选择资料' }).click()
  await expect(page.locator('.mastery-wizard-steps')).toContainText('资料')
  await expect(page.getByRole('tab', { name: '知识库 1' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '展开 kb1' }).click()
  await expect(page.getByRole('button', { name: 'chapter.pdf' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'assets' })).toHaveCount(0)
  await page.getByRole('button', { name: 'chapter.pdf' }).click()
  await expect(page.locator('.mastery-wizard-source-heading')).toContainText('已选择 1 项')
  await page.getByRole('button', { name: 'kb1知识库' }).click()
  await expect(page.locator('.mastery-wizard-source-heading')).toContainText('已选择 1 项')
  await expect(page.getByRole('button', { name: 'chapter.pdf' })).toBeDisabled()
  await page.getByRole('tab', { name: '收藏夹 1' }).click()
  await expect(page.getByRole('button', { name: 'Notes收藏夹' })).toBeVisible()
  await page.getByLabel('搜索资料').fill('missing')
  await expect(page.locator('.mastery-wizard-no-sources')).toBeVisible()
  await page.getByRole('button', { name: '上一步' }).click()
  await expect(page.getByLabel('学习目标')).toHaveValue('Learn linear algebra')
})

test('mastery topic cards show legacy progress details and open a due review directly', async ({ page }) => {
  await allowWithoutAuth(page)
  const topic = {
    path_id: 'p1', name: 'Linear algebra', updated_at: 100, session_count: 2,
    metadata: { goal: 'Learn linear algebra', description: 'Vectors and transformations', emoji: '🧠', status: 'active' },
    map: { complete: false, counts: { mastered: 1, learning: 1, new: 0, total: 2 }, due_reviews: 1, modules: [{ id: 'm1', name: 'Vectors', order: 0, mastered: 1, total: 2, knowledge_points: [] }] },
    reviews: [{ due: true, knowledge_point_name: 'Vectors' }],
  }
  const now = Date.now() / 1000
  const unnamed = {
    path_id: 'unified_1234_abcd', name: 'unified_1234_abcd', updated_at: now - 7 * 86400, session_count: 3,
    metadata: { goal: '', description: '', emoji: '🧭', status: 'active' },
    map: { complete: false, counts: { mastered: 1, learning: 1, new: 0, total: 2 }, due_reviews: 0, modules: [] },
    reviews: [],
  }
  await page.route('**/api/mastery-paths/topics?*', route => route.fulfill({ json: { topics: [topic, unnamed] } }))
  await page.route('**/api/mastery-paths/topics/p1/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.goto('/learning/mastery')
  await expect(page.locator('.mastery-due-banner')).toContainText('1 项复习已在 1 条路径中到期')
  const fallbackCard = page.locator('.mastery-topic-card').filter({ hasText: '探索轨迹 · abcd' })
  await expect(fallbackCard).toContainText('50')
  await expect(fallbackCard.locator('time')).toHaveText('上周')
  await expect(fallbackCard).not.toContainText('unified_1234_abcd')
  const namedStats = page.locator('.mastery-topic-card').filter({ hasText: 'Linear algebra' }).locator('.mastery-topic-stats')
  await expect(namedStats).toContainText('1 个模块')
  await expect(namedStats).toContainText('1/2 个知识点')
  await expect(namedStats).toContainText('2 次会话')
  await page.getByRole('button', { name: /开始复习：Linear algebra/ }).click()
  await expect(page).toHaveURL(/\/learning\/mastery\/p1\/sessions\?mode=review/)
})

test('mastery study workspace mirrors the legacy outline, header controls and responsive mode switch', async ({ page }) => {
  const topic = {
    path_id: 'p1', name: 'Linear algebra', metadata: { goal: 'Learn linear algebra' },
    next: { knowledge_point_id: 'k2', knowledge_point_name: 'Matrices' },
    sources: [{ kind: 'knowledge_base', source_id: 'kb1', label: ' textbook ' }],
    map: { complete: false, counts: { mastered: 1, learning: 1, new: 0, total: 2 }, modules: [{ id: 'm1', name: 'Foundations', knowledge_points: [{ id: 'k1', name: 'Vectors', status: 'mastered' }, { id: 'k2', name: 'Matrices', status: 'learning' }] }] },
  }
  const session = { id: 's1', title: 'Matrices', messages: [{ id: 1, role: 'assistant', content: 'A matrix transforms vectors.' }], preferences: { mastery_session_mode: 'study' } }
  const modeBodies: unknown[] = []
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } })
    if (path === '/api/mastery-paths/topics/p1') return route.fulfill({ json: topic })
    if (path === '/api/mastery-paths/topics/p1/sessions') return route.fulfill({ json: { sessions: [{ ...session, session_id: 's1', message_count: 1 }] } })
    if (path === '/api/sessions/s1') return route.fulfill({ json: session })
    if (path === '/api/mastery-paths/topics/p1/ask-hint') return route.fulfill({ json: { hint: 'How does a matrix transform a vector?' } })
    if (path === '/api/mastery-paths/topics/p1/sessions/s1/mode') {
      const body = route.request().postDataJSON()
      modeBodies.push(body)
      session.preferences.mastery_session_mode = body.mode
      return route.fulfill({ json: { session_id: 's1', ...body } })
    }
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [{ id: 'kb1', name: 'Textbook' }] })
    if (path === '/api/personas' || path === '/api/skills/list' || path === '/api/partners') return route.fulfill({ json: path === '/api/partners' ? [] : { personas: [], skills: [] } })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [{ id: 'n1', name: 'Notes' }] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    return route.fulfill({ json: {} })
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/learning/mastery/p1/sessions/s1')
  await expect(page.locator('.mastery-study-location')).toContainText('Linear algebra')
  await expect(page.locator('.mastery-study-location')).toContainText('Matrices')
  await expect(page.locator('.mastery-study-rail')).toHaveCSS('width', '252px')
  await expect(page.locator('.mastery-study-point')).toHaveCount(2)
  await expect(page.locator('.mastery-study-point.current')).toContainText('Matrices')
  await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'How does a matrix transform a vector?')
  await page.getByRole('button', { name: '隐藏大纲' }).click()
  await expect(page.locator('.mastery-study-rail')).toHaveCSS('width', '36px')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dt.mastery.outline'))).toBe('0')
  await page.reload()
  await expect(page.getByRole('button', { name: '显示大纲' })).toBeVisible()
  await page.getByRole('button', { name: '显示大纲' }).click()
  await expect(page.locator('.mastery-study-rail')).toHaveCSS('width', '252px')

  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect.poll(() => modeBodies.length).toBe(1)
  expect(modeBodies[0]).toEqual({ mode: 'review' })
  await expect(page.locator('.mastery-mode-note')).toContainText('重新检测')
  await page.getByRole('button', { name: '保存到收藏夹', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /保存到收藏夹/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: /保存到收藏夹/ })).toHaveCount(0)
  await page.getByRole('button', { name: '活动', exact: true }).click()
  await expect(page.locator('.activity-panel')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.activity-panel')).toHaveCSS('position', 'fixed')
  await page.locator('.mastery-activity-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.activity-panel')).toBeHidden()
  await expect(page.locator('.mastery-study-rail')).toBeHidden()
  await expect(page.getByRole('group', { name: '对话模式' })).toBeVisible()
  await expect(page.getByRole('group', { name: '对话模式' }).getByRole('button')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('mastery question cards submit answers, skip and challenge through real turn payloads', async ({ page }) => {
  const question = { question_id: 'q1', prompt: 'Which object represents a linear transform?', question_type: 'single_choice', objective: { name: 'Matrices' }, difficulty: 'medium', attempt: 1, allow_free_text: true, options: [{ label: 'A', body: 'A scalar' }, { label: 'B', body: 'A matrix' }] }
  let graded = false
  const session: { id: string; title: string; preferences: Record<string, string>; messages: Array<Record<string, unknown>> } = { id: 's1', title: 'Matrices', preferences: { mastery_session_mode: 'study' }, messages: [] }
  const topic = { path_id: 'p1', name: 'Linear algebra', next: { knowledge_point_id: 'k1', knowledge_point_name: 'Matrices' }, map: { counts: { mastered: 0, total: 1 }, modules: [{ id: 'm1', name: 'Foundations', knowledge_points: [{ id: 'k1', name: 'Matrices', status: 'learning' }] }] } }
  const questionEvent = { type: 'tool_result', turn_id: 't0', seq: 1, metadata: { tool_metadata: { mastery_question: question } } }
  const gradeEvent = { type: 'tool_result', turn_id: 't1', seq: 2, metadata: { tool_metadata: { mastery_grade: { result: { question_id: 'q1', question_type: 'single_choice', is_correct: false, learner_answer: 'A', correct_label: 'B', correct_body: 'A matrix', explanation: 'A matrix defines the transform.' } } } } }
  session.messages = [{ id: 1, role: 'assistant', content: 'Try this check.', events: [questionEvent] }]
  await page.addInitScript(() => {
    const sent: Record<string, unknown>[] = []
    ;(window as unknown as { __masteryMessages: typeof sent }).__masteryMessages = sent
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) { sent.push(JSON.parse(raw) as Record<string, unknown>) }
      close() { this.readyState = 3; this.onclose?.() }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } })
    if (path === '/api/mastery-paths/topics/p1') return route.fulfill({ json: topic })
    if (path === '/api/mastery-paths/topics/p1/sessions') return route.fulfill({ json: { sessions: [{ session_id: 's1', title: 'Matrices' }] } })
    if (path === '/api/sessions/s1') {
      session.messages[0].events = graded ? [questionEvent, gradeEvent] : [questionEvent]
      return route.fulfill({ json: session })
    }
    if (path === '/api/mastery-paths/topics/p1/ask-hint') return route.fulfill({ json: { hint: '' } })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners' || path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    return route.fulfill({ json: {} })
  })
  const sent = () => page.evaluate(() => (window as unknown as { __masteryMessages: Record<string, unknown>[] }).__masteryMessages)

  await page.goto('/learning/mastery/p1/sessions/s1')
  await expect(page.locator('.mastery-question-card')).toContainText('Which object represents a linear transform?')
  await page.locator('.mastery-question-option').filter({ hasText: 'A matrix' }).click()
  await page.locator('.mastery-question-footer').getByRole('button', { name: '提交', exact: true }).click()
  await expect.poll(async () => (await sent()).filter(message => message.type === 'start_turn').length).toBe(1)
  let start = (await sent()).find(message => message.type === 'start_turn')
  expect(start?.mastery_answer).toEqual({ question_id: 'q1', text: 'B', answers: { q1: 'B' } })

  await page.reload()
  await page.getByRole('button', { name: '跳过此题', exact: true }).click()
  await expect.poll(async () => (await sent()).filter(message => message.type === 'start_turn').length).toBe(1)
  start = (await sent()).find(message => message.type === 'start_turn')
  expect(start?.mastery_skip).toEqual({ question_id: 'q1' })
  expect(start?.content).toContain('跳过')

  graded = true
  await page.reload()
  await expect(page.locator('.mastery-question-grade')).toContainText('答案：B')
  await page.getByRole('button', { name: '复核或质疑这次评估' }).click()
  await expect.poll(async () => (await sent()).filter(message => message.type === 'start_turn').length).toBe(1)
  start = (await sent()).find(message => message.type === 'start_turn')
  expect(start?.content).toContain('q1')
  expect(start?.mastery_answer).toBeUndefined()
  expect(start?.mastery_skip).toBeUndefined()
})

test('mastery session camp keeps only legacy open and retry actions with running and relative states', async ({ page }) => {
  await allowWithoutAuth(page)
  const now = Date.now() / 1000
  const topic = { path_id: 'p1', name: 'Linear algebra', metadata: { goal: 'Learn linear algebra', emoji: '🧠', status: 'active' }, map: { complete: false, counts: { mastered: 0, learning: 1, new: 0, total: 1 }, due_reviews: 0, modules: [] }, session_count: 2, reviews: [] }
  const sessions = [
    { session_id: 's1', title: 'Live tutoring', updated_at: now - 20, created_at: now - 200, status: 'running', active_turn_id: 't1', message_count: 4, last_message: 'Checking your answer', archived: false },
    { session_id: 's2', title: 'Previous study', updated_at: now - 3600, created_at: now - 7200, status: 'done', message_count: 8, last_message: 'Matrices summary', archived: false },
  ]
  let failSessions = false
  await page.route('**/api/mastery-paths/topics/p1?*', route => route.fulfill({ json: topic }))
  await page.route('**/api/mastery-paths/topics/p1/sessions?*', route => failSessions ? route.fulfill({ status: 500, json: { detail: 'temporary' } }) : route.fulfill({ json: { sessions } }))
  await page.route('**/api/mastery-paths/progress/p1/board?*', route => route.fulfill({ json: { cards: [] } }))
  await page.goto('/learning/mastery/p1')
  const camp = page.locator('.mastery-session-camp')
  await expect(camp.locator('.mastery-session-row')).toHaveCount(2)
  await expect(camp.locator('.mastery-session-icon.running')).toHaveCount(1)
  await expect(camp).toContainText('导师正在回答')
  await expect(camp).toContainText('8 条消息 · 1小时前')
  await expect(camp.getByRole('button', { name: '归档', exact: true })).toHaveCount(0)
  await expect(camp.getByRole('button', { name: '删除', exact: true })).toHaveCount(0)
  await expect(camp.getByRole('link', { name: '新建学习会话', exact: true })).toHaveAttribute('href', '/learning/mastery/p1/sessions')
  await expect(camp).toContainText('从新的角度开始')

  failSessions = true
  await page.reload()
  await expect(camp.getByRole('button', { name: '无法刷新，点击重试' })).toBeVisible()
  failSessions = false
  await camp.getByRole('button', { name: '无法刷新，点击重试' }).click()
  await expect(camp.locator('.mastery-session-row')).toHaveCount(2)
})
