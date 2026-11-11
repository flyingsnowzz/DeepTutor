import { expect, test } from '@playwright/test'

const partner = { partner_id: 'p1', name: 'Researcher', description: 'Finds sources', emoji: '🦉', color: '#6d5a8c', running: true, can_manage: true, channels: {}, language: 'zh' }

async function mockConfig(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/partners/p1?*', route => {
    if (route.request().url().includes('include_secrets')) return route.fulfill({ json: { ...partner, channels: { telegram: { enabled: false, token: 'secret' } } } })
    return route.fulfill({ json: partner })
  })
  await page.route('**/api/partners/p1/sessions?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/history?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/web-continuity?*', route => route.fulfill({ json: { enabled: false, session_key: null } }))
  await page.route('**/api/partners/p1/links?*', route => route.fulfill({ json: { links: [] } }))
  await page.route('**/api/partners/p1/soul?*', async route => {
    if (route.request().method() === 'PUT') return route.fulfill({ json: {} })
    return route.fulfill({ json: { content: '# Soul\n\nYou are a research partner.' } })
  })
  await page.route('**/api/settings/llm-options?*', route => route.fulfill({ json: { options: [{ profile_id: 'profile1', model_id: 'model1', profile_name: 'Default', model_name: 'GPT' }] } }))
  await page.route('**/api/partners/tool-options?*', route => route.fulfill({ json: { tools: [{ name: 'web_search', description: 'Search the web' }], builtin_tools: [{ name: 'rag', description: 'Attached knowledge' }], mcp_tools: [] } }))
  await page.route('**/api/partners/p1/assets?*', route => route.fulfill({ json: { knowledge_bases: [], skills: [], notebooks: [] } }))
  await page.route('**/api/partners/p1/workspaces?*', route => route.fulfill({ json: { workspaces: [{ workspace_id: 'ws1', kind: 'workspace', display_name: 'Class workspace', archived: false, status: 'ready', follows_root: false, path: '/tmp/ws1', created_at: '' }] } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/skills/list?*', route => route.fulfill({ json: { skills: [] } }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [] } }))
  await page.route('**/api/partners/channels/schema?*', route => route.fulfill({ json: { channels: { telegram: { name: 'telegram', display_name: 'Telegram', available: true, default_config: { enabled: false }, secret_fields: ['token'], json_schema: { properties: { token: { type: 'string', title: 'Token' } } } } } } }))
  await page.route('**/api/partners/p1/channels/status?*', route => route.fulfill({ json: { channels: { telegram: { running: false, setup: { message: 'Ready' } } } } }))
}

test('partner identity, soul, model and tools match the React configure cards', async ({ page }) => {
  await mockConfig(page)
  let identityBody: any = null
  let soulBody: any = null
  await page.route(url => url.pathname === '/api/partners/p1' && url.searchParams.has('dt_workspace'), async route => {
    if (route.request().method() === 'KEEP') return route.continue()
    if (route.request().method() !== 'PATCH') {
      const secret = new URL(route.request().url()).searchParams.has('include_secrets')
      return route.fulfill({ json: secret ? { ...partner, channels: { telegram: { enabled: false, token: 'secret' } } } : partner })
    }
    identityBody = route.request().postDataJSON()
    await route.fulfill({ json: partner })
  })
  await page.route('**/api/partners/p1/soul?*', async route => {
    if (route.request().method() === 'PUT') soulBody = route.request().postDataJSON()
    await route.fulfill({ json: route.request().method() === 'PUT' ? {} : { content: '# Soul\n\nYou are a research partner.' } })
  })
  await page.goto('/partners/p1')
  await page.getByRole('tab', { name: '配置' }).click()

  const identity = page.locator('.partner-identity-section')
  await expect(identity.getByRole('heading', { name: '身份' })).toBeVisible()
  await expect(identity.getByLabel('名称')).toHaveValue('Researcher')
  await expect(identity.getByLabel('回复语言')).toHaveValue('zh')
  await expect(identity.locator('.partner-face-emojis>button')).toHaveCount(24)
  await expect(identity.locator('.partner-face-colors>button')).toHaveCount(8)
  await expect(identity.getByRole('button', { name: '上传图片 / SVG' })).toBeVisible()
  await identity.getByRole('button', { name: '🐳' }).click()
  await identity.getByRole('button', { name: '#4f7a5b' }).click()
  await identity.getByLabel('回复语言').selectOption('en')
  await identity.getByRole('button', { name: '保存' }).click()
  await expect.poll(() => identityBody).toMatchObject({ emoji: '🐳', color: '#4f7a5b', language: 'en' })

  const soulCard = page.locator('.partner-soul-card')
  await soulCard.getByRole('button', { name: '预览' }).click()
  await expect(soulCard.locator('.partner-soul-preview')).toContainText('You are a research partner.')
  await soulCard.getByRole('button', { name: '编辑' }).click()
  await soulCard.getByLabel('SOUL.md').fill('Updated soul')
  await soulCard.getByRole('button', { name: '保存' }).click()
  await expect.poll(() => soulBody).toEqual({ content: 'Updated soul' })

  await expect(page.getByRole('heading', { name: '模型', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '工具', exact: true })).toBeVisible()
  await expect(page.locator('.partner-tool-grid label')).toHaveCount(2)
  await expect(page.getByText('Mounted automatically when the context calls for it', { exact: false })).toHaveCount(0)
  await expect(page.locator('.partner-tool-note').first()).toContainText('自动挂载')
})

test('partner channels render the React master-detail and reveal secrets locally', async ({ page }) => {
  await mockConfig(page)
  await page.goto('/partners/p1')
  await page.getByRole('tab', { name: '频道' }).click()
  await expect(page.locator('.partner-channels-save-row').getByRole('button', { name: '保存' })).toBeVisible()
  await expect(page.locator('.partner-channel-layout>aside')).toHaveCSS('width', '180px')
  await expect(page.locator('.partner-channel-layout>aside')).toContainText('Telegram')
  const secret = page.getByLabel('Token')
  await expect(secret).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: '显示密钥' })).toBeVisible()
  await page.getByRole('button', { name: '显示密钥' }).click()
  await expect(secret).toHaveAttribute('type', 'text')
  await expect(page.getByRole('button', { name: '隐藏密钥' })).toBeVisible()
})


test('partner workspace binding and copied asset library use the real React protocol', async ({ page }) => {
  await mockConfig(page)
  let currentPartner: Record<string, unknown> = { ...partner, workspace_id: '' }
  let assetState = {
    knowledge_bases: [{ name: 'Existing KB' }],
    skills: [] as { name: string }[],
    notebooks: [{ id: 'nb-old', name: 'Old notes' }],
  }
  let workspaceBody: unknown = null
  let addBody: unknown = null
  let removedPath = ''

  await page.route(url => url.pathname === '/api/partners/p1' && url.searchParams.has('dt_workspace'), async route => {
    if (route.request().method() === 'PATCH') {
      workspaceBody = route.request().postDataJSON()
      currentPartner = { ...currentPartner, workspace_id: (workspaceBody as { workspace_id?: string }).workspace_id || '' }
    }
    return route.fulfill({ json: currentPartner })
  })
  await page.route('**/api/partners/p1/workspaces?*', route => route.fulfill({
    json: {
      workspaces: [
        { workspace_id: 'ws1', kind: 'workspace', display_name: 'Class workspace', archived: false, status: 'ready', follows_root: false, path: '/tmp/ws1', created_at: '' },
        { workspace_id: 'general', kind: 'general', display_name: 'General workspace', archived: false, status: 'ready', follows_root: true, path: '/tmp/general', created_at: '' },
        { workspace_id: 'system', kind: 'system', display_name: 'System', archived: false, status: 'ready', follows_root: false, path: '/tmp/system', created_at: '' },
        { workspace_id: 'archived', kind: 'workspace', display_name: 'Archived', archived: true, status: 'ready', follows_root: false, path: '/tmp/archived', created_at: '' },
      ],
    },
  }))
  await page.route('**/api/partners/p1/assets?*', route => route.fulfill({ json: assetState }))
  await page.route('**/api/partners/p1/assets?*', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: assetState })
    addBody = route.request().postDataJSON()
    assetState = {
      ...assetState,
      knowledge_bases: [...assetState.knowledge_bases, { name: 'Physics' }],
    }
    return route.fulfill({
      json: {
        assets: assetState,
        copied: { knowledge_bases: ['Physics'] },
        errors: [{ type: 'skill', name: 'research', error: 'copy failed' }],
      },
    })
  })
  await page.route('**/api/partners/p1/assets/*/*', async route => {
    if (route.request().method() !== 'DELETE') return route.continue()
    removedPath = new URL(route.request().url()).pathname
    assetState = { ...assetState, notebooks: assetState.notebooks.filter(item => item.id !== 'nb-old') }
    return route.fulfill({ json: { assets: assetState } })
  })
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({
    json: [
      { id: 'kb1', name: 'Physics' },
      { id: 'kb-existing', name: 'Existing KB' },
      { id: 'kb-offline', name: 'Offline KB', available: false },
      { id: 'kb-connected', name: 'Obsidian KB', metadata: { type: 'obsidian' } },
    ],
  }))
  await page.route('**/api/skills/list?*', route => route.fulfill({ json: { skills: [{ name: 'research', description: 'Find sources' }, { name: 'writing' }] } }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [{ id: 'nb1', name: 'Notebook One' }, { id: 'nb-old', name: 'Old notes' }] } }))

  await page.goto('/partners/p1')
  await page.getByRole('tab', { name: '配置' }).click()

  const workspace = page.locator('.partner-workspace-card')
  await expect(workspace.getByRole('heading', { name: '工作区' })).toBeVisible()
  await expect(workspace.locator('select')).toContainText('Partner 私有工作区')
  await expect(workspace.locator('select')).toContainText('Class workspace')
  await expect(workspace.locator('select')).toContainText('通用工作区')
  await expect(workspace.locator('select')).not.toContainText('System')

  await workspace.locator('select').selectOption('ws1')
  await expect.poll(() => workspaceBody).toEqual({ workspace_id: 'ws1' })
  await expect(page.getByText('从下一条消息开始生效')).toBeVisible()
  await expect(page.locator('.partner-library-card')).toHaveCount(0)

  await workspace.locator('select').selectOption('')
  await expect.poll(() => workspaceBody).toEqual({ workspace_id: '' })
  const library = page.locator('.partner-library-card')
  await expect(library.getByRole('heading', { name: '资料库' })).toBeVisible()
  await expect(library.getByText('Existing KB')).toBeVisible()
  await expect(library.getByText('Old notes')).toBeVisible()

  await library.getByRole('button', { name: '添加' }).click()
  const picker = library.locator('.partner-asset-picker')
  await expect(picker.getByRole('button', { name: 'Existing KB' })).toHaveCount(0)
  await expect(picker.getByRole('button', { name: 'Offline KB' })).toHaveCount(0)
  await expect(picker.getByRole('button', { name: 'Obsidian KB' })).toHaveCount(0)
  await expect(picker.getByRole('button', { name: 'Old notes' })).toHaveCount(0)

  await picker.getByRole('button', { name: 'Physics' }).click()
  await picker.getByRole('button', { name: 'research' }).click()
  await picker.getByRole('button', { name: '复制进工作区 (2)' }).click()
  await expect.poll(() => addBody).toEqual({ knowledge_bases: ['kb1'], skills: ['research'], notebooks: [] })
  await expect(page.getByText('部分内容失败：research')).toBeVisible()
  await expect(library.getByText('Physics')).toBeVisible()
  await expect(library.getByText('research')).toHaveCount(0)

  await library.locator('li').filter({ hasText: 'Old notes' }).getByRole('button', { name: '移除' }).click()
  await expect.poll(() => removedPath).toBe('/api/partners/p1/assets/notebook/nb-old')
  await expect(library.getByText('Old notes')).toHaveCount(0)
})

test('partner model dropdowns display full choices and save each selection immediately', async ({ page }) => {
  await mockConfig(page)
  let currentPartner: Record<string, unknown> = { ...partner, llm_selection: null, backup_llm_selection: null }
  const patchBodies: Record<string, unknown>[] = []
  await page.route(url => url.pathname === '/api/partners/p1' && url.searchParams.has('dt_workspace'), async route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      patchBodies.push(body)
      currentPartner = { ...currentPartner, ...body }
    }
    return route.fulfill({ json: currentPartner })
  })
  await page.route('**/api/settings/llm-options?*', route => route.fulfill({
    json: {
      active: { profile_id: 'profile1', model_id: 'model1' },
      options: [
        { profile_id: 'profile1', model_id: 'model1', profile_name: 'Default', model_name: 'GPT', model: 'gpt', provider: 'openai', provider_label: 'OpenAI', context_window: 128000 },
        { profile_id: 'profile2', model_id: 'model2', profile_name: 'Reasoning', model_name: 'Claude', model: 'claude', provider: 'anthropic', provider_label: 'Anthropic', context_window: 200000 },
      ],
    },
  }))

  await page.goto('/partners/p1')
  await page.getByRole('tab', { name: '配置' }).click()
  const modelCard = page.locator('.partner-config-card').filter({ has: page.getByRole('heading', { name: '模型', exact: true }) })
  await expect(modelCard.locator('.partner-config-save')).toHaveCount(0)
  const primary = modelCard.locator('.partner-model-dropdown').nth(0)
  const backup = modelCard.locator('.partner-model-dropdown').nth(1)

  await expect(primary.locator('.partner-model-dropdown-trigger strong')).toHaveText('系统默认')
  await expect(primary.locator('.partner-model-dropdown-trigger small')).toHaveText('GPT · OpenAI')
  await primary.locator('.partner-model-dropdown-trigger').click()
  await expect(primary.getByRole('listbox')).toBeVisible()
  await expect(primary.getByRole('option').filter({ hasText: 'GPT' })).toContainText('128K')
  await primary.getByRole('option').filter({ hasText: 'GPT' }).click()
  await expect.poll(() => patchBodies.at(-1)).toEqual({ llm_selection: { profile_id: 'profile1', model_id: 'model1' } })
  await expect(primary.getByRole('listbox')).toHaveCount(0)
  await expect(primary.locator('.partner-model-dropdown-trigger strong')).toHaveText('GPT')

  await expect(backup.locator('.partner-model-dropdown-trigger strong')).toHaveText('不设备用')
  await expect(backup.locator('.partner-model-dropdown-trigger small')).toHaveText('失败的轮次不会重试。')
  await backup.locator('.partner-model-dropdown-trigger').click()
  await backup.getByRole('option').filter({ hasText: 'Claude' }).click()
  await expect.poll(() => patchBodies.at(-1)).toEqual({ backup_llm_selection: { profile_id: 'profile2', model_id: 'model2' } })
  await expect(backup.locator('.partner-model-dropdown-trigger strong')).toHaveText('Claude')
  await expect(page.getByText('模型已更新——下一条消息起生效')).toBeVisible()
})

test('partner tools preserve deny-by-default MCP and existing custom grants', async ({ page }) => {
  await mockConfig(page)
  let currentPartner: Record<string, unknown> = {
    ...partner,
    enabled_tools: ['web_search'],
    builtin_tools: [],
    mcp_tools: ['search-server__lookup'],
  }
  let toolsBody: unknown = null
  await page.route(url => url.pathname === '/api/partners/p1' && url.searchParams.has('dt_workspace'), async route => {
    if (route.request().method() === 'PATCH') {
      toolsBody = route.request().postDataJSON()
      currentPartner = { ...currentPartner, ...(toolsBody as Record<string, unknown>) }
    }
    return route.fulfill({ json: currentPartner })
  })
  await page.route('**/api/partners/tool-options?*', route => route.fulfill({
    json: {
      tools: [{ name: 'brainstorm' }, { name: 'web_search' }],
      builtin_tools: [{ name: 'rag' }, { name: 'memory' }],
      mcp_tools: [{ name: 'search-server__lookup' }, { name: 'search-server__write' }],
    },
  }))

  await page.goto('/partners/p1')
  await page.getByRole('tab', { name: '配置' }).click()
  const toolCard = page.locator('.partner-config-card').filter({ has: page.getByRole('heading', { name: '工具', exact: true }) })
  const grids = toolCard.locator('.partner-tool-grid')
  await expect(grids).toHaveCount(3)
  const checked = (index: number) => grids.nth(index).locator('input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).checked))
  await expect.poll(() => checked(0)).toEqual([false, true])
  await expect.poll(() => checked(1)).toEqual([false, false])
  await expect.poll(() => checked(2)).toEqual([true, false])

  const save = toolCard.getByRole('button', { name: '保存' })
  await expect(save).toBeEnabled()
  await save.click()
  await expect.poll(() => toolsBody).toEqual({
    enabled_tools: ['web_search'],
    builtin_tools: [],
    mcp_tools: ['search-server__lookup'],
  })
  await expect(page.getByText('工具已更新——下一条消息起生效')).toBeVisible()
})
