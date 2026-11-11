import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({
    json: { enabled: false, authenticated: false, is_admin: false, is_super_admin: false },
  }))
}

test('learning journal renders records and retries a failed refresh', async ({ page }) => {
  await allowWithoutAuth(page)
  let reads = 0
  await page.route('**/api/learning-journal*', route => {
    reads += 1
    if (reads === 2) return route.fulfill({ status: 500, json: { detail: 'Journal temporarily unavailable' } })
    return route.fulfill({ json: {
      mission: { topic: 'Linear algebra', why: 'For graphics', level: 'beginner', updated_at: '2026-11-09T08:00:00Z' },
      last_session: { summary: 'Covered vectors', next_focus: 'Matrices', updated_at: '' },
      records: [{ id: 'r1', title: 'Vector basics', insight: 'Vectors have direction.', created_at: '' }],
    } })
  })
  await page.goto('/space/journal')
  await expect(page.getByText('Linear algebra', { exact: true })).toBeVisible()
  await expect(page.getByText('Vectors have direction.')).toBeVisible()
  await page.getByRole('button', { name: '刷新' }).click()
  await expect(page.getByRole('alert')).toContainText('Journal temporarily unavailable')
  await expect(page.getByRole('button', { name: '刷新' })).toBeEnabled()
  await page.getByRole('button', { name: '刷新' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('learning progress shows title resolved progress and activities', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/mastery-paths/reading/records*', route => route.fulfill({ json: {
    progress: [{ material_id: 'm1', furthest_percentage: 0.667 }],
    activities: [{ activity_id: 'a1', material_id: 'm1', action: 'highlight', extension_id: 'reading', locator: 12 }],
  } }))
  await page.route('**/api/reading/library/materials*', route => route.fulfill({ json: {
    materials: [{ material_id: 'm1', title: 'A readable title' }],
  } }))
  await page.goto('/settings/progress')
  await expect(page.getByText('A readable title').first()).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '67')
  await expect(page.getByText('highlight · reading · 位置 12')).toBeVisible()
})

test('legacy watching migration preserves the reading destination', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/sessions/legacy-1/migrate-watching*', route => route.fulfill({ json: {
    id: 'legacy-1', title: 'Legacy', messages: [],
    preferences: { workspace_mode: 'immersive_reading', reading_workspace_id: 'reading-1' },
  } }))
  await page.goto('/learning/watching/legacy-1')
  await expect(page).toHaveURL(/\/learning\/reading\/reading-1\/sessions\/legacy-1\?dt_workspace=$/)
})

test('memory citation resolver reports a deleted entry and returns to memory', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/memory/resolve_entry/missing*', route => route.fulfill({ status: 404, json: { detail: 'Not found' } }))
  await page.goto('/memory/resolve?id=missing')
  await expect(page.getByRole('alert').filter({ hasText: '可能已被删除' })).toContainText('可能已被删除')
  await page.getByRole('link', { name: '返回记忆' }).click()
  await expect(page).toHaveURL(/\/memory$/)
})

test('public device handoff creates and copies a pairing link', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
  })
  await page.route('**/api/auth/session-handoff*', route => route.fulfill({ json: {
    code: 'ABCD-1234', handoff_url: 'https://public.example/handoff?code=ABCD-1234', expires_in: 300,
  } }))
  await page.goto('/session-handoff')
  await page.getByLabel('公共 HTTPS 地址').fill('https://public.example')
  await page.getByRole('button', { name: '创建链接' }).click()
  await expect(page.getByText('ABCD-1234', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '复制链接' }).click()
  await expect(page.getByRole('button', { name: '已复制' })).toBeVisible()
})

test('public device exchange completes and returns to a local destination', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/auth/session-handoff/exchange*', route => route.fulfill({ json: { ticket: 'one-time-ticket' } }))
  await page.route('**/api/auth/session-handoff/complete*', route => route.fulfill({ json: {} }))
  await page.goto('/handoff?code=secret-code&next=%2Fsettings%2Fprogress')
  await expect(page).toHaveURL(/\/settings\/progress$/)
})

test('space hub loads live resource counts without blocking navigation', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/capabilities/registered*', route => route.fulfill({ json: { capabilities: [] } }))
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [{ id: 's1' }, { id: 's2' }] } }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [{ id: 'n1' }] } }))
  await page.route('**/api/question-notebook/entries?*', route => route.fulfill({ json: { total: 42, items: [] } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [{ name: 'kb' }] }))
  await page.goto('/space')
  await expect(page.getByText(/2\s*段对话/)).toBeVisible()
  await expect(page.getByText(/42\s*道题/)).toBeVisible()
  await expect(page.getByText('密语')).toHaveCount(0)
  await page.getByRole('link', { name: /学习日志/ }).click()
  await expect(page).toHaveURL(/\/space\/journal/)
})

test('partner directory exposes status, channels and group navigation', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/partners?*', route => route.fulfill({ json: [
    { partner_id: 'p1', name: 'Researcher', description: 'Finds sources', emoji: '🔎', running: true, channels: ['telegram', 'send_progress'] },
    { partner_id: 'p2', name: 'Writer', description: 'Writes clearly', emoji: '✍️', running: false, channels: [] },
  ] }))
  await page.route('**/api/partner-groups?*', route => route.fulfill({ json: [{
    group_id: 'g1', name: 'Study group', description: 'Learn together', emoji: '👥', color: '#176a5b',
    member_ids: ['p1', 'p2'], members: [], discussion_mode: 'panel_parallel', updated_at: '',
  }] }))
  await page.goto('/partners')
  await expect(page.getByText('Researcher', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('telegram', { exact: true })).toBeVisible()
  await expect(page.getByText('send_progress')).toHaveCount(0)
  await expect(page.getByText('2 位伙伴 · 并行回答')).toBeVisible()
  await page.locator('.partner-directory-card').filter({ hasText: 'Study group' }).click()
  await expect(page).toHaveURL(/\/partners\/groups\/g1/)
})

test('new learning respects account policy and opens a creation route', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/modules?*', route => route.fulfill({ json: { modules: [] } }))
  await page.route('**/api/settings/page-customization?*', route => route.fulfill({ json: { learning: { hidden_features: ['books'] } } }))
  await page.goto('/learning/new')
  const surface = page.locator('.new-learning-page')
  await expect(surface.getByRole('link', { name: /精通之路/ })).toBeVisible()
  await expect(surface.getByRole('link', { name: /输入主题/ })).toHaveCount(0)
  await surface.getByRole('link', { name: /沉浸式阅读/ }).click()
  await expect(page).toHaveURL(/\/learning\/reading\?create=1/)
})

test('learning home filters records and opens a prefilled review', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/dashboard/learning-index*', route => route.fulfill({ json: {
    failed: [], sources: {
      books: [{ id: 'b1', title: 'Book', status: 'paused', updated_at: 20, metadata: { pause_reason: 'quota' } }],
      mastery: [{ path_id: 'p1', name: 'Topic', updated_at: 30, metadata: { status: 'active' }, map: { counts: { total: 2, mastered: 1 } }, reviews: [{ due: true, knowledge_point_name: 'Vectors' }] }],
      reading: [], watching: [], practice: [{ id: 7, question: 'Question', updated_at: 50 }],
    },
  } }))
  await page.route('**/api/mastery-paths/topics/p1/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.goto('/learning')
  await expect(page.getByText('1 项复习已到期')).toBeVisible()
  await expect(page.getByText('已暂停 · quota')).toBeVisible()
  await page.getByRole('link', { name: /1 项复习已到期/ }).click()
  await expect(page).toHaveURL(/\/learning\/mastery\/p1\/sessions\?mode=review/)
  await expect(page.locator('textarea')).toHaveValue(/Vectors/)
})

test('persona library creates, searches and renders a persona', async ({ page }) => {
  await allowWithoutAuth(page)
  const personas: any[] = []
  await page.route('**/api/personas?*', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      personas.push({ ...body, source: 'user', read_only: false })
      await route.fulfill({ json: personas.at(-1) })
    } else await route.fulfill({ json: { personas } })
  })
  await page.route('**/api/personas/patient-tutor?*', route => route.fulfill({ json: personas[0] }))
  await page.goto('/space/personas')
  await page.getByRole('button', { name: '新建人格' }).click()
  await page.getByPlaceholder('patient-tutor').fill('Patient Tutor!')
  await page.getByPlaceholder('在选择器中显示的简短说明').fill('Patient and clear')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('Persona 已保存')).toBeVisible()
  await expect(page.getByText('Patient and clear')).toBeVisible()
  await page.getByRole('button', { name: '查看', exact: true }).click()
  await expect(page.locator('.resource-detail h1')).toHaveText('My Persona')
})

test('profile uploads a cropped avatar and signs out', async ({ page }) => {
  let authenticated = true
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated, user_id: authenticated ? 'u1' : undefined, username: authenticated ? 'learner' : undefined, is_admin: false } }))
  await page.route('**/api/auth/profile?*', route => route.fulfill({ json: { id: 'u1', username: 'learner', role: 'user', created_at: '2026-01-01T00:00:00Z', avatar: '' } }))
  await page.route('**/api/auth/profile/learner-profile?*', route => route.fulfill({ json: { learner_profile: { grade_level: 'Grade 8' } } }))
  await page.route('**/api/auth/profile/avatar*', route => route.fulfill({ json: { avatar: 'img:1' } }))
  await page.route('**/api/auth/avatar/u1?*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }))
  await page.route('**/api/auth/logout*', route => { authenticated = false; return route.fulfill({ json: {} }) })
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'learner' })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  await expect(page.getByText('照片已更新')).toBeVisible()
  await expect(page.locator('.profile-account img')).toBeVisible()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('skill library previews and imports an EduHub skill', async ({ page }) => {
  await allowWithoutAuth(page)
  const skills: any[] = []
  await page.route('**/api/skills/list?*', route => route.fulfill({ json: { skills } }))
  await page.route('**/api/skills/tags/list?*', route => route.fulfill({ json: { tags: ['research'] } }))
  await page.route('**/api/skills/hub/catalog?*', route => route.fulfill({ json: {
    web_url: 'https://eduhub.example', skills: [{ slug: 'research-helper', name: 'Research Helper', summary: 'Find sources', version: '1.0.0', downloads: 12, stars: 3, owner: 'eduhub' }],
  } }))
  await page.route('**/api/skills/hub/detail?*', route => route.fulfill({ json: {
    slug: 'research-helper', name: 'Research Helper', summary: 'Find sources', version: '1.0.0', downloads: 12, stars: 3, owner: 'eduhub', content: '# Research\n\nCite sources.', tags: ['research'],
  } }))
  await page.route('**/api/skills/install?*', route => {
    skills.push({ name: 'research-helper', description: 'Find sources', tags: ['research'], source: 'user', read_only: false })
    return route.fulfill({ json: { verdict: { status: 'verified' } } })
  })
  await page.goto('/space/skills')
  await page.getByRole('button', { name: '从 EduHub 导入' }).click()
  await page.getByRole('button', { name: '查看详情：Research Helper' }).click()
  await expect(page.locator('.hub-detail h1')).toHaveText('Research')
  await page.locator('.hub-detail').getByRole('button', { name: '下载', exact: true }).click()
  await expect(page.getByText('已导入 · verified')).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.resource-page').getByText('research-helper', { exact: true })).toBeVisible()
  await expect(page.getByText('EduHub 技能已导入')).toBeVisible()
})

test('CLI app store installs as administrator and enables an assigned app', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  const installed: any[] = [{ id: 'reader', display_name: 'Reader', description: 'Read files', tool_name: 'reader', category: 'files', trust: 'verified', granted: true, enabled: true, in_catalog: true }]
  await page.route('**/api/space/cli-apps/apps?*', route => route.fulfill({ json: { apps: installed, access: { exec_denied: false } } }))
  await page.route('**/api/space/cli-apps/catalog?*', route => route.fulfill({ json: {
    entries: [{ id: 'writer', display_name: 'Writer', description: 'Write files', category: 'files', trust: 'community', installed: false, installable: true }], categories: { files: 1 }, next_cursor: '', total: 1,
  } }))
  await page.route('**/api/space/cli-apps/catalog/writer/install?*', route => {
    installed.push({ id: 'writer', display_name: 'Writer', description: 'Write files', tool_name: 'writer', category: 'files', trust: 'community', granted: true, enabled: true, in_catalog: true })
    return route.fulfill({ json: { apps: installed, access: { exec_denied: false } } })
  })
  await page.route('**/api/space/cli-apps/apps/reader/enabled?*', route => {
    installed[0].enabled = false
    return route.fulfill({ json: { apps: installed, access: { exec_denied: false } } })
  })
  await page.goto('/space/cli-apps')
  await page.getByRole('switch').click()
  await expect(page.locator('.cli-apps-heading').getByText('0 个可用')).toBeVisible()
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.locator('.cli-catalog-grid li').filter({ hasText: 'Writer' }).click()
  await page.getByRole('button', { name: '安装', exact: true }).click()
  await expect(page.getByText('安装完成')).toBeVisible()
  await expect(page.locator('.cli-apps-heading').getByText('1 个可用')).toBeVisible()
  await page.getByRole('button', { name: /已安装/ }).click()
  await expect(page.getByText('Writer', { exact: true })).toBeVisible()
})

test('chat history filters archives and reopens the owning learning surface', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [
    { id: 'm1', session_id: 'm1', title: 'Mastery', updated_at: 10, content_workspace_id: 'class', preferences: { workspace_mode: 'mastery_path', mastery_path_id: 'p1', pinned: true } },
    { id: 'a1', title: 'Archived', updated_at: 20, preferences: { archived: true } },
  ] } }))
  await page.goto('/space/chat-history')
  await expect(page.getByText('Mastery', { exact: true })).toBeVisible()
  await expect(page.getByText('Archived', { exact: true })).toHaveCount(0)
  await page.getByLabel('归档状态').selectOption('archived')
  await expect(page.getByText('Archived', { exact: true })).toBeVisible()
  await page.getByLabel('归档状态').selectOption('active')
  await page.getByRole('button', { name: /Mastery/ }).click()
  await expect(page).toHaveURL(/\/learning\/mastery\/p1\/sessions\/m1\?dt_workspace=class/)
})

test('notebook creates a collection and exports Markdown', async ({ page }) => {
  await allowWithoutAuth(page)
  const notebooks: any[] = []
  await page.route('**/api/notebooks?*', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      notebooks.push({ id: 'n1', ...body, records: [], record_count: 0 })
      await route.fulfill({ json: { notebook: notebooks[0] } })
    } else await route.fulfill({ json: { notebooks } })
  })
  await page.route('**/api/notebooks/n1?*', route => route.fulfill({ json: notebooks[0] }))
  await page.route('**/api/notebooks/n1/export?*', route => route.fulfill({ status: 200, contentType: 'text/markdown', body: '# Exported notebook' }))
  await page.goto('/notebooks')
  await page.getByLabel('新收藏夹名称').fill('Research')
  await page.getByLabel('新收藏夹描述').fill('Sources')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page).toHaveURL(/\/notebooks\/n1/)
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 Markdown' }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('Research.md')
  await expect(page.getByText('收藏夹已导出')).toBeVisible()
})

test('MCP editor tests and saves a private-origin remote server', async ({ page }) => {
  await allowWithoutAuth(page)
  let state: any = { servers: {}, status: {}, configured_secrets: {}, oauth: {}, rejected: [], deployment: { servers: [] }, limits: { max_servers: 5 } }
  await page.route('**/api/space/mcp/servers?*', route => route.fulfill({ json: state }))
  await page.route('**/api/space/mcp/servers/local/test?*', route => route.fulfill({ json: { ok: true, tools: [{ name: 'search', description: 'Search documents' }] } }))
  await page.route('**/api/space/mcp/servers/local?*', route => {
    const body = route.request().postDataJSON()
    state = { ...state, servers: { local: body.config } }
    return route.fulfill({ json: state })
  })
  await page.goto('/space/mcp')
  await page.getByRole('button', { name: '添加远程服务' }).click()
  await page.getByLabel('名称').fill('local')
  await page.getByLabel('服务 URL').fill('http://host.docker.internal:3000/mcp')
  await page.getByLabel('批准此来源使用私网连接').check()
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('连接成功，发现 1 个工具')).toBeVisible()
  await expect(page.getByText('Search documents')).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('服务已保存')).toBeVisible()
  await expect(page.getByText(/已批准此来源使用私网连接/)).toBeVisible()
})

test('question bank opens and checks an embedded practice question', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/question-notebook/entries?*', route => route.fulfill({ json: { items: [{ id: 1, question: 'What is a vector?', options: { A: 'Direction', B: 'Scalar' }, correct_answer: 'A', explanation: 'Vectors have direction.', user_answer: '', source: 'mastery_path', material_id: 'p1', material_title: 'Math', mastery_path_id: 'p1', session_id: 's1', session_title: 'Study', is_correct: false, resolved: false, bookmarked: false, categories: [], created_at: 1 }], total: 1 } }))
  await page.route('**/api/question-notebook/categories?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/question-notebook/stats?*', route => route.fulfill({ json: { total: 1, wrong: 0, unresolved: 0, bookmarked: 0, uncategorized: 1 } }))
  await page.route('**/api/question-notebook/materials?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/question-notebook/practice/summary?*', route => route.fulfill({ json: { total: 1, mistakes: 0, due: 1, overdue: 0, reviewed_today: 0, next_due_at: null } }))
  await page.route('**/api/question-notebook/practice/questions/1?*', route => route.fulfill({ json: { entry: { id: 1, question: 'What is a vector?', question_type: 'single_choice', options: { A: 'Direction', B: 'Scalar' }, correct_answer: 'A', explanation: 'Vectors have direction.', material_title: 'Math' }, state: { version: 1 } } }))
  await page.route('**/api/question-notebook/practice/questions/1/check?*', route => route.fulfill({ json: { correct: true } }))
  await page.goto('/space/questions')
  await page.getByRole('button', { name: '练习此题' }).click()
  await expect(page).toHaveURL(/\/space\/questions\?question=1/)
  await page.getByRole('radio', { name: 'A Direction' }).check()
  await page.getByRole('button', { name: '核对并显示答案' }).click()
  await expect(page.locator('.practice-reference strong')).toHaveText('正确')
  await expect(page.getByText('Vectors have direction.')).toBeVisible()
  await page.getByRole('button', { name: '← 返回题库' }).click()
  await expect(page).toHaveURL(/\/space\/questions$/)
})

test('task board creates, edits and drags a card between columns', async ({ page }) => {
  await allowWithoutAuth(page)
  let board: any = { cards: [], revision: 0, colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [] }
  await page.route('**/api/task-board?*', route => route.fulfill({ json: board }))
  await page.route('**/api/calendar/task-blocks?*', route => route.fulfill({ json: {} }))
  await page.route('**/api/task-board/cards?*', route => {
    const body = route.request().postDataJSON()
    board = { ...board, cards: [{ id: 't1', title: body.title, note: '', status: 'todo', due_date: null, archived: false }] }
    return route.fulfill({ json: board })
  })
  await page.route('**/api/task-board/cards/t1?*', route => {
    const body = route.request().postDataJSON()
    board = { ...board, cards: [{ ...board.cards[0], ...body }] }
    return route.fulfill({ json: board })
  })
  await page.goto('/kanban')
  await page.getByLabel('新任务').fill('Read chapter')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Read chapter', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Read chapter', exact: true }).click()
  await page.getByLabel('任务标题').fill('Read chapter 4')
  await page.getByLabel('任务备注').fill('Chapter 4 notes')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('Chapter 4 notes')).toBeVisible()
  await page.locator('.task-card').hover()
  await expect(page.locator('.task-card-actions')).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: 'Read chapter 4: 移至 进行中' }).click()
  await expect(page.locator('section[aria-label="进行中"]').getByText('Read chapter 4')).toBeVisible()
  await page.locator('section[aria-label="进行中"] .task-card').hover()
  await expect(page.locator('section[aria-label="进行中"] .task-card-actions')).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: 'Read chapter 4: 移至 待办' }).click()
  await expect(page.locator('section[aria-label="待办"]').getByText('Read chapter 4')).toBeVisible()
  await page.locator('.task-card').dragTo(page.locator('section[aria-label="进行中"]'))
  await expect(page.locator('section[aria-label="进行中"]').getByText('Read chapter 4')).toBeVisible()
})

test('co-writer home creates a page and shows due flashcards', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/documents?*', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { id: 'new-page', title: '', preview: '', updated_at: 1, parent_id: null, pinned: false, revision: 1, icon: '' } })
    return route.fulfill({ json: { documents: [] } })
  })
  await page.route('**/api/documents/review/due?*', route => route.fulfill({ json: { cards: [{ page_id: 'p1', page_title: 'Biology', block_id: 'b1', card_id: 'c1', front: 'Front', back: 'Back' }] } }))
  await page.route('**/api/documents/p1/review?*', route => route.fulfill({ json: {} }))
  await page.goto('/co-writer')
  await page.getByRole('button', { name: /复习记忆卡/ }).click()
  await page.getByRole('button', { name: '显示答案' }).click()
  await expect(page.getByText('Back', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '记住了' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.co-writer-header').getByRole('button', { name: '新建页面', exact: true }).click()
  await expect(page).toHaveURL(/\/co-writer\/new-page/)
})

test('co-writer rich editor autosaves block ids and exports Word', async ({ page }) => {
  await allowWithoutAuth(page)
  const document: any = { id: 'doc1', title: 'Research', content: '', revision: 1, parent_id: null, icon: '', cover: '', pinned: false, blocks: [
    { id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Original text', styles: {} }], children: [] },
    { id: 'm1', type: 'math', props: { formula: 'x^2', custom: { keep: true } }, content: [], children: [] },
  ] }
  await page.route('**/api/documents/doc1?*', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      Object.assign(document, { title: body.title ?? document.title, blocks: body.blocks ?? document.blocks, revision: document.revision + 1 })
      return route.fulfill({ json: document })
    }
    return route.fulfill({ json: document })
  })
  await page.route('**/api/documents?*', route => route.fulfill({ json: { documents: [document] } }))
  await page.route('**/api/documents/doc1/suggestions?*', route => route.fulfill({ json: { suggestions: [] } }))
  await page.route('**/api/documents/export/docx?*', route => route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: 'docx' }))
  await page.goto('/co-writer/doc1')
  await page.locator('.rich-note-content p').first().selectText()
  await page.keyboard.type('Updated rich text')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  await expect.poll(() => document.revision).toBe(2)
  expect(document.blocks[0].id).toBe('p1')
  expect(document.blocks[0].content[0].text).toBe('Updated rich text')
  expect(document.blocks[1]).toEqual({ id: 'm1', type: 'math', props: { formula: 'x^2', custom: { keep: true } }, content: [], children: [] })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '导出 Word' }).click()
  expect((await downloaded).suggestedFilename()).toBe('Research.docx')
})

test('co-writer companion saves before sending and anchors the new session', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.addInitScript(() => {
    const messages: any[] = []
    ;(window as any).__wsMessages = messages
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) {
        const value = JSON.parse(raw)
        messages.push(value)
        if (value.type !== 'start_turn') return
        for (const [seq, payload] of Object.entries([
          { type: 'session_meta', session_id: 's1', turn_id: 't1', seq: 1 },
          { type: 'content', session_id: 's1', turn_id: 't1', seq: 2, content: 'Companion answer' },
          { type: 'done', session_id: 's1', turn_id: 't1', seq: 3 },
        ])) setTimeout(() => this.onmessage?.({ data: JSON.stringify(payload) }), 10 * seq)
      }
      close() { this.readyState = 3; this.onclose?.() }
    }
    ;(window as any).WebSocket = FakeWebSocket
  })
  const document: any = { id: 'doc1', title: 'Research', content: '', revision: 1, parent_id: null, icon: '', cover: '', pinned: false, blocks: [{ id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Original', styles: {} }], children: [] }] }
  const threads: any[] = []
  let anchor: any = null
  await page.route('**/api/documents/doc1?*', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      Object.assign(document, { title: body.title ?? document.title, blocks: body.blocks ?? document.blocks, revision: document.revision + 1 })
      return route.fulfill({ json: document })
    }
    return route.fulfill({ json: document })
  })
  await page.route('**/api/documents?*', route => route.fulfill({ json: { documents: [document] } }))
  await page.route('**/api/documents/doc1/suggestions?*', route => route.fulfill({ json: { suggestions: [] } }))
  await page.route('**/api/documents/doc1/threads?*', async route => {
    if (route.request().method() === 'POST') {
      anchor = route.request().postDataJSON()
      threads.push({ ...anchor, title: 'Companion', status: 'idle' })
      return route.fulfill({ json: threads.at(-1) })
    }
    return route.fulfill({ json: { threads } })
  })
  await page.route('**/api/sessions/s1?*', route => route.fulfill({ json: { id: 's1', title: 'Companion', messages: [{ id: 1, role: 'assistant', content: 'Companion answer' }] } }))
  await page.goto('/co-writer/doc1')
  await page.locator('.rich-note-content p').first().selectText()
  await page.keyboard.type('Edited before chat')
  await page.getByRole('button', { name: '伴读助手', exact: true }).click()
  await page.locator('.co-writer-assistant textarea').fill('Explain this paragraph')
  await page.locator('.co-writer-assistant form').getByRole('button', { name: '发送' }).click()
  await expect.poll(() => document.revision).toBe(2)
  await expect.poll(() => anchor?.session_id).toBe('s1')
  expect(anchor.block_id).toBe('p1')
  const messages = await page.evaluate(() => (window as any).__wsMessages)
  const start = messages.find((message: any) => message.type === 'start_turn')
  expect(start.note_document_id).toBe('doc1')
  expect(start.content).toBe('Explain this paragraph')
  await expect(page.locator('.co-writer-assistant').getByText('Companion answer')).toBeVisible()
})

test('memory graph selects a node and opens its L2 source', async ({ page }) => {
  await allowWithoutAuth(page)
  const entry = 'm_00000000000000000000000000'
  await page.route('**/api/memory/snapshot/*', route => {
    const surface = new URL(route.request().url()).pathname.split('/').at(-1)
    return route.fulfill({ json: { entities: surface === 'chat' ? [{ id: 'e1', label: 'Conversation', ts: '', content: 'Raw' }] : [] } })
  })
  await page.route('**/api/memory/doc/L2/*', route => {
    const surface = new URL(route.request().url()).pathname.split('/').at(-1)
    return route.fulfill({ json: { content: surface === 'chat' ? `# Chat\n\n- Summary [^1] <!--${entry}-->\n\n[^1]: chat:e1` : '' } })
  })
  await page.route('**/api/memory/doc/L3/*', route => {
    const slot = new URL(route.request().url()).pathname.split('/').at(-1)
    return route.fulfill({ json: { content: slot === 'profile' ? `# Profile\n\n- Preference [^1] <!--${entry}-->\n\n[^1]: chat:${entry}` : '' } })
  })
  await page.goto('/memory/graph')
  await expect(page.locator('.memory-node')).toHaveCount(3)
  await page.locator(`[data-node="L2:chat:${entry}"]`).click()
  await page.locator(`[data-node="L2:chat:${entry}"]`).dblclick()
  await expect(page).toHaveURL(new RegExp(`/memory/l2/chat\\?focus=${entry}`))
})

test('memory workbench focuses an entry and saves an edited document', async ({ page }) => {
  await allowWithoutAuth(page)
  const entry = 'm_00000000000000000000000000'
  let content = `# Chat\n\n- Summary <!--${entry}-->`
  await page.route('**/api/memory/overview?*', route => route.fulfill({ json: { docs: [{ layer: 'L2', key: 'chat', exists: true, updated_at: 'now', entry_count: 1, backlog: 0 }] } }))
  await page.route('**/api/memory/doc/L2/chat?*', async route => {
    if (route.request().method() === 'PUT') { content = route.request().postDataJSON().content; return route.fulfill({ json: { content } }) }
    return route.fulfill({ json: { content } })
  })
  await page.route('**/api/memory/doc/L2/chat/lines?*', route => route.fulfill({ json: { lines: [{ number: 1, kind: 'title', text: '# Chat' }] } }))
  await page.goto(`/memory/l2/chat?focus=${entry}`)
  await expect(page.locator(`#${entry}`)).toBeAttached()
  await expect(page.locator(`#${entry}`).locator('..')).toHaveClass(/memory-entry-focused/)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByLabel('记忆文档 Markdown').fill('# Updated')
  await page.getByRole('button', { name: '保存文档' }).click()
  await expect(page.getByText('文档已保存')).toBeVisible()
  await expect(page.locator('.markdown-body h1')).toHaveText('Updated')
})

test('partner group creation selects members and a discussion mode', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/partners?*', route => route.fulfill({ json: [{ partner_id: 'p1', name: 'One', description: 'First' }, { partner_id: 'p2', name: 'Two', description: 'Second' }] }))
  await page.route('**/api/partner-groups/discussion-modes?*', route => route.fulfill({ json: [{ name: 'panel_parallel', label: '', description: '' }, { name: 'debate', label: '', description: '' }] }))
  await page.route('**/api/partner-groups?*', route => route.fulfill({ json: { group_id: 'g1' } }))
  await page.goto('/partners/groups/new')
  await page.getByLabel('名称').fill('Study group')
  await page.getByRole('button', { name: 'One First' }).click()
  await page.getByRole('button', { name: 'Two Second' }).click()
  await page.getByRole('button', { name: /交叉辩论/ }).click()
  await page.getByRole('button', { name: /创建群组/ }).click()
  await expect(page).toHaveURL(/\/partners\/groups\/g1/)
})

test('practice home starts a due review and completes a rating', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/question-notebook/practice/summary?*', route => route.fulfill({ json: { total: 1, mistakes: 0, due: 1, overdue: 0, reviewed_today: 0, next_due_at: null } }))
  await page.route('**/api/question-notebook/practice/queue?*', route => route.fulfill({ json: [{ entry: { id: 1 }, state: { version: 1 } }] }))
  await page.route('**/api/question-notebook/practice/questions/1?*', route => route.fulfill({ json: { entry: { id: 1, question: 'Question', question_type: 'single_choice', options: { A: 'Yes', B: 'No' }, correct_answer: 'A', explanation: 'Because', material_title: 'Math' }, state: { version: 1 } } }))
  await page.route('**/api/question-notebook/practice/questions/1/check?*', route => route.fulfill({ json: { correct: true } }))
  await page.route('**/api/question-notebook/practice/questions/1/review?*', route => route.fulfill({ json: { due_at: 1 } }))
  await page.route('**/api/question-notebook/practice/analytics?*', route => route.fulfill({ json: { daily: [], sources: [], totals: { questions: 0, mistakes: 0, reviews: 0 } } }))
  await page.goto('/learning/practice')
  await page.getByRole('button', { name: '开始今日复习' }).click()
  await page.getByRole('radio', { name: 'A Yes' }).check()
  await page.getByRole('button', { name: '核对并显示答案' }).click()
  await expect(page.locator('.practice-reference strong')).toHaveText('正确')
  await page.getByRole('button', { name: '已掌握', exact: true }).click()
  await expect(page.getByRole('heading', { name: '练习完成' })).toBeVisible()
})

test('super administrator creates an administrator account', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true, is_super_admin: true, username: 'root' } }))
  const administrators: any[] = []
  await page.route('**/api/auth/admin/accounts?*', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      administrators.push({ id: 'a1', username: body.username, super_admin: false })
      return route.fulfill({ json: administrators.at(-1) })
    }
    return route.fulfill({ json: { administrators } })
  })
  await page.goto('/admin/accounts')
  await page.getByPlaceholder('用户名').fill('admin2')
  await page.getByPlaceholder('密码（至少 8 位）').fill('long-enough')
  await page.getByRole('button', { name: '创建管理员', exact: true }).click()
  await expect(page.getByText('admin2', { exact: true })).toBeVisible()
})

test('administrator creates a learner and prevents deleting the current account', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true, is_super_admin: false, username: 'admin' } }))
  const users: any[] = [{ id: 'u1', username: 'admin', role: 'admin', preset: 'custom', created_at: '2026-01-01' }]
  await page.route('**/api/auth/users?*', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      users.push({ id: 'u2', username: body.username, role: 'user', preset: body.preset, created_at: '2026-01-02' })
      return route.fulfill({ json: users.at(-1) })
    }
    return route.fulfill({ json: users })
  })
  await page.goto('/admin/users')
  await page.getByRole('button', { name: '添加用户', exact: true }).click()
  await page.getByPlaceholder('用户名', { exact: true }).fill('learner')
  await page.getByPlaceholder('密码（至少 8 位）').fill('long-enough')
  await page.getByRole('button', { name: '学习者', exact: true }).click()
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.getByText('learner', { exact: true })).toBeVisible()
  await expect(page.getByLabel('选择 admin')).toBeDisabled()
  await expect(page.locator('.admin-row-actions').getByRole('button', { name: '删除' }).first()).toBeDisabled()
})

test('chat sends attachments and renders streamed markdown and downloads', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.addInitScript(() => {
    const messages: any[] = []
    ;(window as any).__chatMessages = messages
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) {
        const value = JSON.parse(raw); messages.push(value)
        if (value.type !== 'start_turn') return
        for (const [seq, payload] of Object.entries([
          { type: 'session_meta', session_id: 's1', turn_id: 't1', seq: 1 },
          { type: 'content', session_id: 's1', turn_id: 't1', seq: 2, content: '**Answer**' },
          { type: 'done', session_id: 's1', turn_id: 't1', seq: 3 },
        ])) setTimeout(() => this.onmessage?.({ data: JSON.stringify(payload) }), seq * 10)
      }
      close() { this.readyState = 3; this.onclose?.() }
    }
    ;(window as any).WebSocket = FakeWebSocket
  })
  await page.route('**/api/capabilities/registered?*', route => route.fulfill({ json: [{ id: 'chat', available: true }, { id: 'deep_research', available: true }] }))
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.route('**/api/sessions/s1?*', route => route.fulfill({ json: { id: 's1', title: 'Session', messages: [{ id: 1, role: 'assistant', content: '**Answer**', attachments: [{ type: 'file', filename: 'result.pdf', url: '/files/result.pdf' }] }] } }))
  await page.goto('/chat')
  await page.getByLabel('对话能力').selectOption('deep_research')
  await page.locator('.research-config-select').nth(0).selectOption('report')
  await page.locator('.research-config-select').nth(1).selectOption('quick')
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await page.getByPlaceholder('今天我能帮您什么？').fill('Analyze this')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.message.assistant strong')).toHaveText('Answer')
  const messages = await page.evaluate(() => (window as any).__chatMessages)
  const start = messages.find((message: any) => message.type === 'start_turn')
  expect(start.capability).toBe('deep_research')
  expect(start.attachments[0].filename).toBe('note.txt')
  await expect(page.locator('.message-attachments a')).toHaveAttribute('href', /files\/result.pdf/)
})

test('partner wizard creates a configured partner', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/partners/soul-sources?*', route => route.fulfill({ json: { library: [{ id: 'mentor', name: 'Mentor', content: 'Be kind' }], personas: [] } }))
  await page.route('**/api/settings/llm-options?*', route => route.fulfill({ json: { active: { profile_id: 'default', model_id: 'chat' }, options: [{ profile_id: 'default', model_id: 'chat', profile_name: 'Default', model_name: 'Chat' }, { profile_id: 'backup', model_id: 'reason', profile_name: 'Backup', model_name: 'Reason' }] } }))
  await page.route('**/api/partners/tool-options?*', route => route.fulfill({ json: { tools: [{ name: 'web_search', description: '' }], builtin_tools: [{ name: 'rag' }], mcp_tools: [] } }))
  await page.route('**/api/settings/workspace/registrations?*', route => route.fulfill({ json: { workspaces: [] } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [{ name: 'kb1' }] }))
  await page.route('**/api/skills/list?*', route => route.fulfill({ json: { skills: [{ name: 'research' }] } }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [] } }))
  await page.route('**/api/partners?*', route => route.fulfill({ json: { partner_id: 'p1' } }))
  await page.goto('/partners/new')
  await page.getByPlaceholder('伙伴叫什么？').fill('Researcher')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByText('SOUL.md')).toBeVisible()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.locator('.partner-model-select > button').click()
  await page.getByRole('option', { name: /Reason/ }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.locator('.partner-asset-chips').getByRole('button', { name: 'kb1', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByText('Backup · Reason')).toBeVisible()
  await page.getByRole('button', { name: '创建并启动' }).click()
  await expect(page).toHaveURL(/\/partners\/p1/)
})

test('knowledge base creation uploads files and completes indexing', async ({ page }) => {
  await allowWithoutAuth(page)
  const bases: any[] = []
  let progress: any = { stage: 'running', percent: 40, message: 'Indexing' }
  await page.route('**/api/knowledge-bases/rag-providers?*', route => route.fulfill({ json: { providers: [{ id: 'llamaindex', name: 'LlamaIndex', description: 'Local', configured: true, modes: ['hybrid'], default_mode: 'hybrid' }] } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: bases }))
  await page.route('**/api/knowledge-bases/rag-pipelines/model-options?*', route => route.fulfill({ json: { embedding: { active: { profile_id: 'p1', model_id: 'm1' }, options: [{ profile_id: 'p1', profile_name: 'Local', model_id: 'm1', label: 'embed' }] } } }))
  await page.route('**/api/knowledge-bases/rag-pipelines/llamaindex/config?*', route => route.fulfill({ json: { retrieval_profile: 'hybrid', top_k: 5, chunk_size: 512, chunk_overlap: 50 } }))
  await page.route('**/api/knowledge-bases?*', route => {
    bases.push({ name: 'kb1', status: 'ready', is_default: false, read_only: false })
    return route.fulfill({ json: { name: 'kb1', task_id: 't1', stage: 'running', percent: 40 } })
  })
  await page.route('**/api/knowledge-bases/kb1?*', route => route.fulfill({ json: bases[0] }))
  await page.route('**/api/knowledge-bases/kb1/files?*', route => route.fulfill({ json: { files: [{ name: 'guide.txt', type: 'file' }] } }))
  await page.route('**/api/knowledge-bases/default/kb1?*', route => { bases[0].is_default = true; return route.fulfill({ json: {} }) })
  await page.route('**/api/knowledge-bases/kb1/progress?*', route => {
    progress = { ...progress, stage: 'completed', percent: 100, message: 'Completed' }
    return route.fulfill({ json: progress })
  })
  await page.goto('/knowledge-bases')
  await page.getByRole('button', { name: '新建知识库', exact: true }).first().click()
  await page.getByLabel('知识库名称').fill('kb1')
  await page.getByLabel('创建时上传文件').setInputFiles({ name: 'guide.txt', mimeType: 'text/plain', buffer: Buffer.from('guide') })
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page).toHaveURL(/\/knowledge-bases\/kb1/)
  await expect(page.locator('.knowledge-progress')).toHaveCount(0)
  await expect(page.getByText('guide.txt')).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '设为默认' }).click()
  await expect(page.getByText('已设为默认知识库')).toBeVisible()
})

test('calendar moves an event to another day and updates automation layers', async ({ page }) => {
  await allowWithoutAuth(page)
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const event = { id: 'e1', event_id: 'e1', occurrence: today.toISOString(), recurring: false, calendar_id: 'c1', title: 'Study', notes: '', location: '', all_day: true, start: key(today), end: key(today), rrule: null, color: null }
  let changes: any = null
  await page.route('**/api/calendar/calendars?*', route => route.fulfill({ json: { calendars: [{ id: 'c1', name: 'Main', color: '#123456', visible: true, is_default: true }] } }))
  await page.route('**/api/calendar/events?*', route => route.fulfill({ json: { occurrences: [event] } }))
  await page.route('**/api/calendar/layers?*', route => route.fulfill({ json: { reviews: [], automations: [{ id: 'a1', job_id: 'j1', name: 'Reminder', at: 'tomorrow', enabled: true }], footprints: [] } }))
  await page.route('**/api/calendar/stream*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))
  await page.route('**/api/task-board?*', route => route.fulfill({ json: { cards: [] } }))
  await page.route('**/api/calendar/events/e1?*', route => { changes = route.request().postDataJSON(); return route.fulfill({ json: {} }) })
  await page.route('**/api/calendar/automations/j1?*', route => route.fulfill({ json: {} }))
  await page.goto('/calendar')
  await page.locator('.calendar-cell').filter({ hasText: 'Study' }).first().locator('.calendar-event-chip').first().dragTo(page.locator(`[data-day="${key(tomorrow)}"]`))
  await expect.poll(() => changes?.changes?.start).toBe(key(tomorrow))
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByText('自动任务已取消')).toBeVisible()
})

test('partner group edits discussion mode and direct chat streams a reply', async ({ page }) => {
  await allowWithoutAuth(page)
  const group = { group_id: 'g1', name: 'Group', description: '', member_ids: ['p1', 'p2'], members: [], discussion_mode: 'panel_parallel' }
  await page.route('**/api/partner-groups/g1?*', async route => {
    if (route.request().method() === 'PATCH') { Object.assign(group, route.request().postDataJSON()); return route.fulfill({ json: group }) }
    return route.fulfill({ json: group })
  })
  await page.route('**/api/partner-groups/g1/sessions?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partner-groups/g1/history?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners?*', route => route.fulfill({ json: [{ partner_id: 'p1', name: 'One' }, { partner_id: 'p2', name: 'Two' }] }))
  await page.route('**/api/partner-groups/discussion-modes?*', route => route.fulfill({ json: [{ name: 'panel_parallel', label: '', description: '' }, { name: 'debate', label: '', description: '' }] }))
  await page.goto('/partners/groups/g1')
  await page.getByRole('button', { name: '管理', exact: true }).click()
  await page.getByLabel('讨论方式').selectOption('debate')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存')).toBeVisible()
  expect(group.discussion_mode).toBe('debate')

  await page.route('**/api/partners/p1?*', route => route.fulfill({ json: { partner_id: 'p1', name: 'Partner', can_manage: true, running: true } }))
  await page.route('**/api/partners/p1/sessions?*', route => route.fulfill({ json: [{ session_key: 'default', title: 'Default' }] }))
  await page.route('**/api/partners/p1/history?*', route => route.fulfill({ json: [{ role: 'assistant', content: '**Answer**' }] }))
  await page.route('**/api/partners/p1/chat/execute-stream?*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: content\ndata: {"content":"**Answer**"}\n\nevent: done\ndata: {}\n\n' }))
  await page.goto('/partners/p1')
  await page.getByPlaceholder('输入消息…').fill('Question')
  await page.getByRole('button', { name: /发送/ }).click()
  await expect(page.locator('.partner-direct-messages strong').first()).toHaveText('Answer')
})

test('mastery creation selects materials and opens an outline session', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [{ name: 'kb1' }] }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [] } }))
  await page.route('**/api/mastery-paths/topics?*', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { path_id: 'p1', name: 'Math', metadata: { goal: 'Learn math', emoji: '🧭' }, map: { counts: { mastered: 0, learning: 0, new: 0, total: 0 }, due_reviews: 0, modules: [] }, session_count: 0, reviews: [] } })
    return route.fulfill({ json: { topics: [] } })
  })
  await page.route('**/api/mastery-paths/topics/p1/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.goto('/learning/mastery')
  await page.getByPlaceholder('描述你的学习目标').fill('Learn linear algebra')
  await page.getByRole('button', { name: '新建精通目标' }).click()
  await page.locator('.mastery-wizard-footer').getByRole('button', { name: '选择资料' }).click()
  await page.getByLabel('kb1知识库').click()
  await page.getByRole('button', { name: '和导师一起定大纲' }).click()
  await expect(page).toHaveURL(/\/learning\/mastery\/p1\/sessions\?mode=outline/)
  await expect(page.locator('textarea')).toHaveValue(/design the outline/)
})

test('book reader edits a block and submits a quiz', async ({ page }) => {
  await allowWithoutAuth(page)
  const pageData: any = { id: 'p2', title: 'Second', status: 'ready', order: 2, blocks: [{ id: 'q1', type: 'quiz', title: 'Question', status: 'ready', payload: { question: 'A?', options: { A: 'Yes', B: 'No' }, correct_answer: 'A' } }] }
  const detail: any = { book: { id: 'b1', title: 'Book', description: '', status: 'ready', revision: 2, page_count: 2, chapter_count: 1, can_edit: true, can_delete: true }, spine: { chapters: [] }, pages: [{ id: 'p1', title: 'First', status: 'ready', order: 1, blocks: [] }, pageData], progress: { current_page_id: 'p2', visited_page_ids: [], bookmarked_page_ids: [] } }
  await page.route('**/api/books?*', route => route.fulfill({ json: { books: [], can_create: true } }))
  await page.route('**/api/books/b1?*', route => route.fulfill({ json: detail }))
  await page.route('**/api/books/b1/pages/p2?*', route => route.fulfill({ json: { page: pageData } }))
  await page.route('**/api/books/progress/visit?*', route => route.fulfill({ json: {} }))
  await page.route('**/api/books/quiz-attempt?*', route => route.fulfill({ json: { progress: detail.progress } }))
  await page.route('**/api/books/update-block?*', route => { pageData.blocks[0].payload.body = 'Updated'; return route.fulfill({ json: { block: pageData.blocks[0], book_revision: 3 } }) })
  await page.goto('/learning/books/b1/pages/p2')
  await page.getByRole('radio', { name: 'A. Yes' }).check()
  await page.getByRole('button', { name: '提交答案' }).click()
  await expect(page.getByText('回答正确')).toBeVisible()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByLabel('块内容', { exact: true }).fill('Updated')
  await page.getByRole('button', { name: '保存块' }).click()
  await expect(page.getByText('内容块已保存')).toBeVisible()
})

test('reading selection is sent with material revision and locator', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.addInitScript(() => {
    const messages: any[] = []
    ;(window as any).__readingMessages = messages
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) {
        const value = JSON.parse(raw); messages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'session_meta', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3; this.onclose?.() }
    }
    ;(window as any).WebSocket = FakeWebSocket
  })
  await page.route('**/api/reading/workspaces/w1?*', route => route.fulfill({ json: { workspace: { workspace_id: 'w1', title: 'Collection', active_material_id: 'm1', tabs: [{ material: { material_id: 'm1', title: 'Guide', filename: 'guide.html', render_mode: 'html', status: 'ready', revision: 3 } }] } } }))
  await page.route('**/api/reading/workspaces/w1/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.route('**/api/reading/materials/m1/render?*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><p>A selected reading passage</p></body></html>' }))
  await page.route('**/api/sessions/s1?*', route => route.fulfill({ json: { id: 's1', title: 'Reading', messages: [] } }))
  await page.goto('/learning/reading/w1/sessions')
  const passage = page.frameLocator('iframe').locator('p')
  await passage.selectText()
  await passage.click()
  await expect(page.locator('.reading-selection')).toContainText('A selected reading passage')
  await page.getByPlaceholder('就这份资料提问…').fill('Explain this')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(async () => (await page.evaluate(() => (window as any).__readingMessages)).length).toBeGreaterThan(0)
  const messages = await page.evaluate(() => (window as any).__readingMessages)
  const start = messages.find((message: any) => message.type === 'start_turn')
  expect(start.reading_material_id).toBe('m1')
  expect(start.reading_material_revision).toBe(3)
  expect(start.reading_viewport).toEqual({ locator: 1, selection: 'A selected reading passage' })
  expect(start.reading_references).toEqual([{ material_id: 'm1', revision: 3, locators: [1] }])
})

test('agent import scans a Claude project and imports JSONL conversations', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.addInitScript(() => {
    const lines = [
      { type: 'user', timestamp: '2026-01-01T00:00:00Z', cwd: '/demo', message: { role: 'user', content: 'Hello agent' } },
      { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', cwd: '/demo', message: { role: 'assistant', content: 'Hello learner' } },
    ].map(row => JSON.stringify(row)).join('\n')
    const file = new File([lines], 'session-1.jsonl', { lastModified: Date.now() })
    const fileHandle = { kind: 'file', name: 'session-1.jsonl', getFile: async () => file }
    const project = { kind: 'directory', name: 'demo', async *values() { yield fileHandle } }
    const projects = { kind: 'directory', name: 'projects', async *values() { yield project } }
    const root = Object.create({ getDirectoryHandle: async () => projects }, { kind: { value: 'directory', enumerable: true }, name: { value: '.claude', enumerable: true } })
    ;(window as any).showDirectoryPicker = async () => root
  })
  const imported: any[] = []
  await page.route('**/api/subagents/detect?*', route => route.fulfill({ json: { backends: [] } }))
  await page.route('**/api/subagents/connections?*', route => route.fulfill({ json: { connections: [] } }))
  await page.route('**/api/imports/chat-history?*', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      imported.push(...body.sessions.map((session: any) => ({
        id: session.external_id,
        session_id: session.external_id,
        title: session.title,
        created_at: session.created_at,
        updated_at: session.updated_at,
        last_message: session.messages.at(-1).content,
        preferences: { import: { source: body.source, source_cwd: session.source_cwd, agent_id: body.agent_id } },
      })))
      return route.fulfill({ json: { imported: body.sessions.length, skipped: 0, sessions: [] } })
    }
    return route.fulfill({ json: { sessions: imported } })
  })
  await page.goto('/agents')
  await page.getByRole('button', { name: '导入对话', exact: true }).click()
  await page.getByRole('button', { name: '选择 .claude 或 .codex 目录' }).click()
  await page.getByPlaceholder('例如：我的 Claude').fill('My Claude')
  await page.getByRole('button', { name: '开始导入' }).click()
  await expect(page.getByText('导入 1 段新对话，跳过 0 段已有对话')).toBeVisible()
  await expect(page.getByText('Hello agent')).toBeVisible()
  await expect(page.getByText('My Claude')).toBeVisible()
})

test('co-writer inserts a quiz block and saves its answer', async ({ page }) => {
  await allowWithoutAuth(page)
  const document: any = { id: 'doc1', title: 'Research', content: '', revision: 1, parent_id: null, icon: '', cover: '', pinned: false, blocks: [{ id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Text', styles: {} }], children: [] }] }
  await page.route('**/api/documents/doc1?*', async route => {
    if (route.request().method() === 'PUT') { const body = route.request().postDataJSON(); Object.assign(document, { blocks: body.blocks, revision: document.revision + 1 }); return route.fulfill({ json: document }) }
    return route.fulfill({ json: document })
  })
  await page.route('**/api/documents?*', route => route.fulfill({ json: { documents: [document] } }))
  await page.route('**/api/documents/doc1/suggestions?*', route => route.fulfill({ json: { suggestions: [] } }))
  await page.route('**/api/question-notebook/entries/upsert?*', route => route.fulfill({ json: {} }))
  await page.goto('/co-writer/doc1')
  await page.getByLabel('特殊块类型').selectOption('quiz')
  await page.getByLabel('特殊块内容').fill('Choose A')
  await page.getByRole('button', { name: '插入特殊块' }).click()
  await page.getByRole('radio', { name: 'A. Option A' }).check()
  await page.getByRole('button', { name: '提交答案' }).click()
  await expect(page.getByText('回答正确')).toBeVisible()
  await expect.poll(() => document.blocks.some((block: any) => block.type === 'learning' && JSON.parse(block.props.data).attempts?.length === 1)).toBe(true)
})

test('co-writer uploads and inserts an image asset', async ({ page }) => {
  await allowWithoutAuth(page)
  const document: any = { id: 'doc1', title: 'Research', content: '', revision: 1, parent_id: null, icon: '', cover: '', pinned: false, blocks: [{ id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Text', styles: {} }], children: [] }] }
  await page.route('**/api/documents/doc1?*', async route => {
    if (route.request().method() === 'PUT') { const body = route.request().postDataJSON(); Object.assign(document, { blocks: body.blocks, revision: document.revision + 1 }); return route.fulfill({ json: document }) }
    return route.fulfill({ json: document })
  })
  await page.route('**/api/documents?*', route => route.fulfill({ json: { documents: [document] } }))
  await page.route('**/api/documents/doc1/suggestions?*', route => route.fulfill({ json: { suggestions: [] } }))
  await page.route('**/api/documents/doc1/assets?*', route => route.fulfill({ json: { url: '/api/documents/doc1/assets/image-1' } }))
  await page.route('**/api/documents/doc1/assets/image-1?*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }))
  await page.goto('/co-writer/doc1')
  await page.getByLabel('上传笔记附件').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  await expect(page.locator('.learning-special-block img')).toBeVisible()
  await expect.poll(() => document.blocks.some((block: any) => block.type === 'image' && block.props.name === 'pixel.png')).toBe(true)
})

test('reading selection runs a translation extension', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/reading/workspaces/w1?*', route => route.fulfill({ json: { workspace: { workspace_id: 'w1', title: 'Collection', active_material_id: 'm1', tabs: [{ material: { material_id: 'm1', title: 'Guide', filename: 'guide.html', render_mode: 'html', status: 'ready', revision: 1 } }] } } }))
  await page.route('**/api/reading/workspaces/w1/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.route('**/api/reading/materials/m1/render?*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><p>A selected reading passage</p></body></html>' }))
  await page.route('**/api/reading/extensions?*', route => route.fulfill({ json: [{ id: 'translation', actions: [{ id: 'translate', label: '翻译' }] }] }))
  await page.route('**/api/reading/materials/m1/extensions/translation/actions/translate?*', route => route.fulfill({ json: { translation: 'Translated', alternatives: [] } }))
  await page.goto('/learning/reading/w1/sessions')
  const passage = page.frameLocator('iframe').locator('p')
  await passage.selectText()
  await passage.click()
  await page.getByRole('button', { name: '翻译', exact: true }).click()
  await expect(page.locator('.reading-extension-result')).toContainText('Translated')
})

function singlePagePdf(text: string): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length 55 >>\nstream\nBT /F1 12 Tf 40 200 Td (${text}) Tj ET\nendstream\nendobj\n`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) { offsets.push(Buffer.byteLength(pdf)); pdf += object }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index++) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}

test('PDF text layer supports selecting a passage for the tutor', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/reading/workspaces/w1?*', route => route.fulfill({ json: { workspace: { workspace_id: 'w1', title: 'Collection', active_material_id: 'm1', tabs: [{ material: { material_id: 'm1', title: 'Guide', filename: 'guide.pdf', render_mode: 'pdf', status: 'ready', revision: 2 } }] } } }))
  await page.route('**/api/reading/workspaces/w1/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.route('**/api/reading/materials/m1/raw?*', route => route.fulfill({ status: 200, contentType: 'application/pdf', body: singlePagePdf('Hello PDF') }))
  await page.route('**/api/reading/extensions?*', route => route.fulfill({ json: [] }))
  await page.goto('/learning/reading/w1/sessions')
  await expect(page.locator('.pdf-text-layer span').first()).toBeVisible()
  const passage = page.locator('.pdf-text-layer').getByText('Hello PDF')
  await passage.selectText()
  await passage.click()
  await expect(page.locator('.reading-selection')).toContainText('Hello PDF')
})

test('partner configuration saves soul and schema-driven channel settings', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/partners/p1?*', route => route.fulfill({ json: { partner_id: 'p1', name: 'Partner', can_manage: true, running: true, channels: {} } }))
  await page.route('**/api/partners/p1/sessions?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/history?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/soul?*', route => route.fulfill({ json: { content: 'Original soul' } }))
  await page.route('**/api/settings/llm-options?*', route => route.fulfill({ json: { options: [] } }))
  await page.route('**/api/partners/tool-options?*', route => route.fulfill({ json: { tools: [{ name: 'web_search' }], builtin_tools: [], mcp_tools: [] } }))
  await page.route('**/api/partners/p1/assets?*', route => route.fulfill({ json: { knowledge_bases: [], skills: [], notebooks: [] } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/skills/list?*', route => route.fulfill({ json: { skills: [] } }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [] } }))
  await page.route('**/api/partners/channels/schema?*', route => route.fulfill({
    json: { channels: { telegram: {
      display_name: 'Telegram', default_config: { enabled: false }, secret_fields: ['token'],
      json_schema: { properties: { token: { type: 'string', title: 'Token' } } },
    } } },
  }))
  await page.route('**/api/partners/p1/links?*', route => route.fulfill({ json: { links: [] } }))
  await page.route('**/api/partners/p1/channels/status?*', route => route.fulfill({ json: { channels: {} } }))
  await page.route('**/api/partners/p1?include_secrets=true*', route => route.fulfill({
    json: { channels: { telegram: { enabled: false, token: 'secret' } } },
  }))
  await page.route('**/api/partners/p1/soul?*', route => route.fulfill({ json: {} }))
  await page.goto('/partners/p1')
  await expect(page.getByRole('tab', { name: /聊天/ }).locator('svg')).toHaveAttribute('width', '14')
  await expect(page.getByRole('tab', { name: /配置/ }).locator('svg')).toHaveAttribute('width', '14')
  await expect(page.getByRole('tab', { name: /频道/ }).locator('svg')).toHaveAttribute('width', '14')
  await expect(page.getByRole('tab', { name: /历史/ }).locator('svg')).toHaveAttribute('width', '14')
  await expect(page.getByRole('button', { name: '归档' }).locator('svg')).toHaveAttribute('width', '16')
  await expect(page.getByRole('button', { name: '保存到收藏夹' }).locator('svg')).toHaveAttribute('width', '16')
  await expect(page.getByRole('button', { name: '下载 Markdown' }).locator('svg')).toHaveAttribute('width', '16')
  await expect(page.getByRole('button', { name: '链接聊天账号' }).locator('svg')).toHaveAttribute('width', '16')
  await expect(page.getByRole('button', { name: '停止伙伴' }).locator('svg')).toHaveAttribute('width', '16')
  await expect(page.getByRole('button', { name: '删除伙伴' }).locator('svg')).toHaveAttribute('width', '16')
  await page.getByRole('tab', { name: /历史/ }).click()
  await expect(page.locator('.partner-archive-layout')).toBeVisible()
  await page.getByRole('tab', { name: /聊天/ }).click()
  await page.getByRole('tab', { name: /配置/ }).click()
  await page.getByLabel('SOUL.md').fill('Updated soul')
  await page.locator('.partner-soul-card').getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('灵魂已保存')).toBeVisible()
  await page.getByRole('tab', { name: /频道/ }).click()
  await page.locator('.partner-channel-card input[type="password"]').fill('new-secret')
  await page.locator('.partner-channels-save-row').getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('频道配置已保存')).toBeVisible()
})

test('knowledge engine saves mode and configuration as administrator', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/knowledge-bases/rag-providers?*', route => route.fulfill({ json: { providers: [{ id: 'graphrag', name: 'GraphRAG', description: 'Graph retrieval', configured: true, modes: ['local', 'global'], default_mode: 'local' }] } }))
  await page.route('**/api/knowledge-bases/rag-pipelines/graphrag/config?*', async route => {
    if (route.request().method() === 'PUT') return route.fulfill({ json: route.request().postDataJSON() })
    return route.fulfill({ json: { retrieval_profile: 'hybrid', top_k: 5 } })
  })
  await page.route('**/api/knowledge-bases/rag-pipelines/graphrag/preflight?*', route => route.fulfill({ json: { checks: [{ key: 'ready', label: 'Ready', ok: true }] } }))
  await page.route('**/api/knowledge-bases/rag-providers/graphrag/mode?*', route => route.fulfill({ json: { provider: 'graphrag', mode: 'global' } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [] }))
  await page.goto('/knowledge-bases?engine=graphrag')
  await page.getByLabel('检索模式').selectOption('global')
  await page.locator('.engine-config-form input[type="number"]').fill('8')
  await page.getByRole('button', { name: '保存引擎配置' }).click()
  await expect(page.getByText('引擎配置已保存')).toBeVisible()
})

test('whisper explains when the external capability plugin is unavailable', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/capabilities/registered*', route => route.fulfill({ json: { capabilities: [] } }))
  await page.goto('/whisper')
  await expect(page.getByRole('heading', { name: '服务器尚未安装 Whisper' })).toBeVisible()
  await expect(page.getByText('练习室依赖单独的能力插件。请管理员安装后再使用。')).toBeVisible()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toHaveCount(0)
})

test('whisper dual-seat flow carries room ids and hides supervisor notes from visitors', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/capabilities/registered*', route => route.fulfill({ json: { capabilities: [{ id: 'whisper_visitor', available: true }] } }))
  await page.addInitScript(() => {
    class Socket {
      static OPEN = 1
      static instances: Socket[] = []
      readyState = 0
      sent: any[] = []
      onopen?: () => void
      onmessage?: (event: { data: string }) => void
      onclose?: () => void
      onerror?: () => void
      constructor(_url: string) { Socket.instances.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) { this.sent.push(JSON.parse(raw)) }
      emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
      close() { this.readyState = 3 }
    }
    ;(window as any).WebSocket = Socket
    ;(window as any).__whisperSockets = Socket.instances
  })
  await page.goto('/whisper')
  await page.getByLabel('来访者消息').fill('I need help')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__whisperSockets.at(-1)?.sent.length)).toBe(1)
  await page.evaluate(() => {
    const socket = (window as any).__whisperSockets.at(-1)
    socket.emit({ type: 'session_meta', session_id: 'visitor-session' })
    socket.emit({ type: 'content', content: 'Created room_id=room-e2e' })
    socket.emit({ type: 'done' })
  })
  await expect(page.getByText(/Created room_id=room-e2e/)).toBeVisible()
  await page.getByRole('tab', { name: '咨询师', exact: true }).click()
  await page.getByLabel('咨询师消息').fill('Tell me more')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__whisperSockets.at(-1)?.sent.length)).toBe(2)
  const traineeStart = await page.evaluate(() => (window as any).__whisperSockets.at(-1).sent[1])
  expect(traineeStart).toMatchObject({ capability: 'whisper_trainee', config: { room_id: 'room-e2e' } })
  await page.evaluate(() => {
    const socket = (window as any).__whisperSockets.at(-1)
    socket.emit({ type: 'session_meta', session_id: 'trainee-session' })
    socket.emit({ type: 'content', content: 'Private supervisor hint', stage: 'whisper', source: 'whisper_trainee' })
    socket.emit({ type: 'done' })
  })
  await expect(page.getByText('Private supervisor hint')).toBeVisible()
  await page.getByRole('tab', { name: '来访者', exact: true }).click()
  await expect(page.getByText('Private supervisor hint')).toHaveCount(0)
  await expect(page.getByText(/Created room_id=room-e2e/)).toBeVisible()
})
