import { expect, test, type Page } from '@playwright/test'

async function mockBase(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {
    theme: 'snow', language: 'zh', response_language: 'zh', chat_response_timeout: 300,
    code_block_theme: 'oneDark', code_block_show_line_numbers: true, code_block_wrap_long_lines: false,
  } } }))
}

test('settings search, draft persistence and apply follow the legacy workflow', async ({ page }) => {
  await mockBase(page)
  let storedDraft: unknown = null
  const writes: string[] = []
  await page.route('**/api/settings/draft?*', route => {
    if (route.request().method() === 'PUT') {
      storedDraft = route.request().postDataJSON()
      writes.push('PUT draft')
      return route.fulfill({ json: { draft: storedDraft } })
    }
    if (route.request().method() === 'DELETE') {
      storedDraft = null
      writes.push('DELETE draft')
      return route.fulfill({ json: {} })
    }
    return route.fulfill({ json: { draft: storedDraft } })
  })
  await page.route('**/api/settings/ui?*', route => {
    writes.push('PUT ui')
    return route.fulfill({ json: {} })
  })
  await page.goto('/settings/general')
  await page.getByLabel('搜索设置').fill('嵌入')
  await expect(page.locator('.legacy-settings-search-results a')).toHaveCount(1)
  await expect(page.locator('.legacy-settings-search-results a')).toHaveText('嵌入模型')
  await page.getByRole('button', { name: '清除', exact: true }).click()
  await page.getByLabel('模型输出语言').selectOption('zh-tw')
  await page.getByRole('button', { name: '存草稿', exact: true }).click()
  await expect(page.locator('.legacy-settings-toolbar')).toContainText('草稿尚未应用')
  await page.reload()
  await expect(page.getByLabel('模型输出语言')).toHaveValue('zh-tw')
  await expect(page.locator('.legacy-settings-toolbar')).toContainText('草稿尚未应用')
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.locator('.legacy-settings-toast')).toHaveText('已应用')
  expect(writes).toEqual(['PUT draft', 'PUT draft', 'PUT ui', 'DELETE draft'])
})

test('appearance exposes every theme and code-block option through the shared draft bar', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto('/settings/appearance')
  await expect(page.locator('.legacy-theme-card')).toHaveCount(4)
  await expect(page.getByLabel('语法主题').locator('option')).toHaveCount(46)
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.getByRole('switch', { name: '显示行号' }).click()
  await expect(page.locator('.legacy-code-line').first().locator('i')).toHaveCount(0)
  await expect(page.locator('.legacy-settings-toolbar')).toContainText('有未保存的更改')
  await page.getByRole('button', { name: '放弃', exact: true }).click()
  await expect(page.locator('.legacy-theme-card').first()).toHaveAttribute('aria-pressed', 'true')
})

test('tool search, details and toggles stage the real enabled-tool list', async ({ page }) => {
  await mockBase(page)
  const hints = { short_description: 'Search the web', when_to_use: 'Current facts', input_format: '{ query }', guideline: 'Cite sources', note: '', aliases: [] }
  await page.route('**/api/tools?*', route => route.fulfill({ json: {
    enabled_optional_tools: [],
    tools: [
      { name: 'web_search', description: 'Web search', parameters: [{ name: 'query', type: 'string', description: 'Search query', required: true }], hints: { en: hints, zh: { ...hints, short_description: '联网搜索' } }, aliases: [], toggleable: true, enabled: false },
      { name: 'read_skill', description: 'Read a skill', parameters: [], hints: { en: hints }, aliases: [], toggleable: false, enabled: true },
    ],
  } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto('/settings/tools')
  await expect(page.locator('.legacy-tools-groups section')).toHaveCount(2)
  await page.getByLabel('搜索工具').fill('web_search')
  await expect(page.locator('.legacy-tool-row')).toHaveCount(1)
  await page.getByRole('switch', { name: '关闭', exact: true }).click()
  await expect(page.locator('.legacy-settings-toolbar')).toContainText('有未保存的更改')
  await page.locator('.legacy-tool-summary').click()
  await expect(page.getByText(/Search query/)).toBeVisible()
})

test('model workspace adds a profile and applies the selected service config', async ({ page }) => {
  const catalog = { services: {
    llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', name: 'Provider', provider: 'openai', models: [{ id: 'm1', model: 'gpt-test', name: 'Test model' }] }] },
    task: { active_profile_id: null, active_model_id: null, profiles: [], mode: 'inherit', overrides: {} },
  } }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { catalog, ui: { language: 'zh', theme: 'snow' }, task_kinds: [] } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  let applied: { service?: string; config?: { profiles?: { id: string }[] } } | null = null
  await page.route('**/api/settings/apply/service?*', route => {
    applied = route.request().postDataJSON()
    return route.fulfill({ json: {} })
  })
  await page.goto('/settings/llm')
  await expect(page.locator('.model-rail-card')).toHaveCount(1)
  await page.locator('.model-add-button').click()
  await page.getByLabel('Profile ID', { exact: true }).fill('personal-llm')
  await page.getByLabel('Profile 显示名称', { exact: true }).fill('My personal model')
  await page.getByLabel('Profile 提供方', { exact: true }).fill('openai')
  await page.getByLabel('Profile Base URL', { exact: true }).fill('http://127.0.0.1:9/v1')
  await page.getByLabel('Profile API Key', { exact: true }).fill('test-only')
  await page.getByLabel('首个模型 ID', { exact: true }).fill('test-model')
  await page.getByRole('button', { name: '添加 Profile', exact: true }).click()
  await expect(page.locator('.model-catalog-toolbar')).toContainText('有未保存的更改')
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.locator('.model-catalog-toast')).toHaveText('模型配置已应用')
  expect(applied?.service).toBe('llm')
  expect(applied?.config?.profiles?.some(profile => profile.id === 'personal-llm')).toBe(true)
})

test('model connection test streams results and adopts detected context explicitly', async ({ page }) => {
  const catalog = { services: {
    llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', name: 'Provider', provider: 'openai', models: [{ id: 'm1', model: 'gpt-test', name: 'Test model' }] }] },
    task: { active_profile_id: null, active_model_id: null, profiles: [], mode: 'inherit', overrides: {} },
  } }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { catalog, ui: { language: 'zh', theme: 'snow' }, task_kinds: [] } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/tests/llm/start?*', route => route.fulfill({ json: { run_id: 'run1' } }))
  await page.route('**/api/settings/tests/llm/run1/events?*', route => route.fulfill({
    contentType: 'text/event-stream',
    body: [
      'data: {"type":"response","snippet":"OK"}\n\n',
      'data: {"type":"context_window","context_window":128000,"source":"metadata","detected_at":"2026-01-01T00:00:00Z"}\n\n',
      'data: {"type":"completed","message":"Done"}\n\n',
    ].join(''),
  }))
  let appliedModel: { context_window?: string } | null = null
  await page.route('**/api/settings/apply/service?*', route => {
    const body = route.request().postDataJSON()
    appliedModel = body.config.profiles[0].models[0]
    return route.fulfill({ json: {} })
  })
  await page.goto('/settings/llm')
  await page.getByRole('button', { name: '测试模型', exact: true }).click()
  await expect(page.getByText('模型响应成功', { exact: true })).toBeVisible()
  await expect(page.getByText('检测到上下文：128000 tokens', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '采用检测值', exact: true }).click()
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.locator('.model-catalog-toast')).toHaveText('模型配置已应用')
  expect(appliedModel?.context_window).toBe('128000')
})
