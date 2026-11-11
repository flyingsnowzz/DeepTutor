import { expect, test, type Page } from '@playwright/test'

async function adminAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

test('runtime status renders modules, memory and readiness groups without JSON or request errors', async ({ page }) => {
  await adminAuth(page)
  await page.route('**/api/settings?*', route => route.fulfill({ json: { catalog: { services: { llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', models: [{ id: 'm1', model: 'gpt-test' }] }] } } }, ui: {} } }))
  await page.route('**/api/settings/readiness?*', route => route.fulfill({ json: {
    ok: true,
    summary: { enabled_verified: 1, available_disabled: 0, unavailable: 0, misconfigured: 0, not_selected: 1 },
    rows: [
      { id: 'catalog.llm', section: 'catalog', label: 'Language model', state: 'enabled_verified', detail_code: '', enabled: true, available: true, configured: true, verified: true, required: true },
      { id: 'catalog.search', section: 'catalog', label: 'Search', state: 'not_selected', detail_code: 'not_configured', enabled: true, available: false, configured: false, verified: false, required: false },
    ],
    notices: [],
  } }))
  await page.route('**/api/modules?*', route => route.fulfill({ json: { modules: [{ id: 'core', installed: true, enabled: true, ready: true, issues: [] }] } }))
  await page.route('**/api/system/status?*', route => route.fulfill({ json: { backend: { status: 'online' } } }))
  await page.route('**/api/system/memory?*', route => route.fulfill({ json: { available: true, total_rss_bytes: 536870912, available_bytes: 4294967296, usage_ratio: 0.1, processes: [{ label: 'backend', count: 1, rss_bytes: 536870912 }] } }))
  await page.goto('/settings/status')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('core', { exact: true })).toBeVisible()
  await expect(page.getByText('在线', { exact: true })).toBeVisible()
  await expect(page.getByText('512 MB', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Language model', { exact: true })).toBeVisible()
  await expect(page.getByText('gpt-test', { exact: true })).toBeVisible()
  await page.getByText('另有 1 项未启用', { exact: true }).click()
  await expect(page.locator('.status-groups details').getByRole('link', { name: '搜索', exact: true })).toBeVisible()
})

test('usage renders yearly totals, heatmap and full model table', async ({ page }) => {
  await adminAuth(page)
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {} } }))
  await page.route('**/api/settings/usage?*', route => route.fulfill({ json: {
    year: 2026, tracked_turns: 2, sessions: 1, active_days: 1, turns: 2,
    totals: { total_tokens: 1200, prompt_tokens: 800, completion_tokens: 400, cache_hit_rate: 0.5, total_calls: 2 },
    days: [{ date: '2026-01-01', total_tokens: 1200, total_calls: 2, turns: 2, tracked_turns: 2 }],
    models: [{ provider: 'openai', model: 'gpt-test', total_tokens: 1200, prompt_tokens: 800, completion_tokens: 400, cache_hit_rate: 0.5, total_calls: 2, ttft_seconds: 0.25, tokens_per_second: 20 }],
  } }))
  await page.goto('/settings/usage')
  await expect(page.getByText('1,200', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('50.0%', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('gpt-test', { exact: true })).toBeVisible()
  await expect(page.getByText('0.25 s', { exact: true })).toBeVisible()
  await expect(page.locator('.usage-week button')).toHaveCount(371)
  await expect(page.getByRole('button', { name: '下一年' })).toBeDisabled()
})

test('about checks updates and confirms an update job with project links', async ({ page }) => {
  await adminAuth(page)
  const status = {
    current_version: '1.7.0', check_enabled: true, checked_at: '2026-01-01', check_error: '', update_available: true,
    release: { version: '1.8.0', url: 'https://example.com/release' },
    installation: { mode: 'source', automatic_update: true, command: '', reason: 'Source checkout' },
    launcher_managed: true, is_admin: true, job: null,
  }
  await page.route('**/api/system/update?*', route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { id: 'job1', status: 'succeeded', error: null } })
    return route.fulfill({ json: status })
  })
  await page.route('**/api/system/update/check?*', route => route.fulfill({ json: status }))
  await page.goto('/settings/about')
  await expect(page.getByText('1.7.0', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: '源代码' })).toHaveAttribute('href', 'https://github.com/HKUDS/DeepTutor')
  await expect(page.locator('.legacy-setting-links').getByRole('link', { name: /文档/ })).toHaveAttribute('href', 'https://docs.deeptutor.info')
  await page.getByRole('button', { name: '立即检查', exact: true }).click()
  await page.getByRole('button', { name: '更新到 1.8.0', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('更新并重启')
  await page.getByRole('button', { name: '更新并重启', exact: true }).click()
  await expect(page.locator('.about-job')).toContainText('succeeded')
})

test('capability settings use the shared draft and apply workflow', async ({ page }) => {
  await adminAuth(page)
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {} } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  let saved: { chat?: { max_rounds?: number } } | null = null
  await page.route('**/api/capabilities/settings?*', route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON()
      return route.fulfill({ json: saved })
    }
    return route.fulfill({ json: { chat: { temperature: 0.7, max_rounds: 12, stage_budgets: { exploring: 4000, responding: 4000 } } } })
  })
  await page.goto('/settings/capabilities')
  await page.getByLabel('最大轮数').first().fill('14')
  await expect(page.locator('.legacy-settings-toolbar')).toContainText('有未保存的更改')
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.locator('.legacy-settings-toast')).toHaveText('已应用')
  expect(saved?.chat?.max_rounds).toBe(14)
})

test('video learning selects providers, tests Invidious and applies the same draft', async ({ page }) => {
  await adminAuth(page)
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {} } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  let tested: { default_provider?: string; invidious?: { api_base_url?: string; public_base_url?: string } } | null = null
  let saved: { default_provider?: string; invidious?: { api_base_url?: string; public_base_url?: string } } | null = null
  await page.route('**/api/settings/video-learning/test-invidious?*', route => {
    tested = route.request().postDataJSON()
    return route.fulfill({ json: { ok: true, message: 'v1.0' } })
  })
  await page.route('**/api/settings/video-learning?*', route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON()
      return route.fulfill({ json: saved })
    }
    return route.fulfill({ json: { version: 1, default_provider: 'youtube', youtube: { transcript_provider: 'youtube_transcript_api' }, invidious: { api_base_url: '', public_base_url: '' } } })
  })
  await page.goto('/settings/video-learning')
  await page.getByRole('button', { name: /自托管 Invidious/ }).click()
  await page.getByLabel('后端 API 来源').fill('http://invidious.local')
  await page.getByLabel('浏览器访问来源（可选）').fill('http://localhost:3000')
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await expect(page.locator('.video-test-message')).toContainText('Invidious 已连接')
  expect(tested?.default_provider).toBe('invidious')
  expect(tested?.invidious?.api_base_url).toBe('http://invidious.local')
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.locator('.legacy-settings-toast')).toHaveText('已应用')
  expect(saved?.default_provider).toBe('invidious')
  expect(saved?.invidious?.public_base_url).toBe('http://localhost:3000')
})

test('document parsing selects Tika, tests the server and applies engine options', async ({ page }) => {
  await adminAuth(page)
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {} } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/llm-options?*', route => route.fulfill({ json: { options: [] } }))
  let saved: { engine?: string; engines?: { tika?: { server_url?: string } } } | null = null
  await page.route('**/api/settings/document-parsing/tika/test?*', route => route.fulfill({ json: { ok: true, message: 'Tika 3.0' } }))
  await page.route('**/api/settings/document-parsing?*', route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON()
      return route.fulfill({ json: saved })
    }
    return route.fulfill({ json: {
      engine: 'text_only', image_description_model: null, engines: { text_only: {}, tika: { server_url: '' } },
      available_engines: [
        { id: 'text_only', name: 'Text only', description: '', needs_local_models: false, available: true },
        { id: 'tika', name: 'Apache Tika', description: '', needs_local_models: false, available: true },
      ],
      readiness: { tika: { ready: true, reason: 'ready', message: '' } }, installable: [], mineru: { api_token_set: false },
    } })
  })
  await page.goto('/settings/knowledge')
  await page.locator('.document-engine-list button').filter({ hasText: 'Apache Tika' }).click()
  await page.getByLabel('服务器地址').fill('http://tika.local')
  await page.getByRole('button', { name: '测试', exact: true }).click()
  await expect(page.locator('.document-test-result')).toHaveText('Tika 3.0')
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.locator('.legacy-settings-toast')).toHaveText('已应用')
  expect(saved?.engine).toBe('tika')
  expect(saved?.engines?.tika?.server_url).toBe('http://tika.local')
})

test('MinerU cloud settings test credentials and apply through their own endpoint', async ({ page }) => {
  await adminAuth(page)
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {} } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/llm-options?*', route => route.fulfill({ json: { options: [] } }))
  await page.route('**/api/settings/document-parsing?*', route => route.fulfill({ json: {
    engine: 'mineru', image_description_model: null, engines: { mineru: {} },
    available_engines: [{ id: 'mineru', name: 'MinerU', description: '', needs_local_models: true, available: true }],
    readiness: {}, installable: [], mineru: { api_token_set: false },
  } }))
  const live = { mode: 'local', api_base_url: 'https://mineru.net', local_cli_path: '', model_download_source: 'huggingface', model_download_endpoint: '', model_version: 'pipeline', language: 'auto', enable_formula: true, enable_table: true, is_ocr: false, allow_local_model_download: false }
  await page.route('**/api/settings/mineru/test?*', route => route.fulfill({ json: { ok: true, message: 'Token valid' } }))
  let saved: { mode?: string; api_base_url?: string; api_token?: string } | null = null
  await page.route('**/api/settings/mineru?*', route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON()
      return route.fulfill({ json: { settings: saved, api_token_set: true } })
    }
    return route.fulfill({ json: { settings: live, api_token_set: false, local_cli: { found: false, command: '', path: '' } } })
  })
  await page.goto('/settings/knowledge')
  await page.getByRole('button', { name: '云端 API', exact: true }).click()
  await page.getByLabel('API 地址').fill('https://mineru.example')
  await page.getByRole('textbox', { name: 'API Token', exact: true }).fill('secret-token')
  await page.getByRole('button', { name: '测试', exact: true }).click()
  await expect(page.locator('.mineru-test')).toContainText('Token valid')
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.locator('.legacy-settings-toast')).toHaveText('已应用')
  expect(saved?.mode).toBe('cloud')
  expect(saved?.api_base_url).toBe('https://mineru.example')
  expect(saved?.api_token).toBe('secret-token')
})

test('memory budgets and chunk boundaries use the shared apply bar', async ({ page }) => {
  await adminAuth(page)
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {} } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  let saved: { update?: { l2_budget?: number }; chunking?: { boundary?: string } } | null = null
  await page.route('**/api/memory/settings?*', route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON()
      return route.fulfill({ json: saved })
    }
    return route.fulfill({ json: {
      update: { l2_budget: 4, l3_budget: 4 }, audit: { l2_budget: 4, l3_budget: 4 }, dedup: { iterations: 3, auto_after_update: false },
      merge: { auto_after_update: false, auto_after_audit: false, auto_after_dedup: false },
      chunking: { overlap_ratio: 0.1, boundary: 'paragraph', min_chunk_chars: 1200, max_chunk_chars: 4000 }, reference: { enforce_required: true, drop_invalid_refs: true },
    } })
  })
  await page.goto('/settings/memory')
  await page.getByLabel('L2 预算（每个 surface）').first().fill('8')
  await page.getByLabel('边界').selectOption('sentence')
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.locator('.legacy-settings-toast')).toHaveText('已应用')
  expect(saved?.update?.l2_budget).toBe(8)
  expect(saved?.chunking?.boundary).toBe('sentence')
})

test('workspace creation, instructions and root migration use legacy actions', async ({ page }) => {
  await adminAuth(page)
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {} } }))
  await page.route('**/api/settings/workspace/resources?*', route => route.fulfill({ json: { skills: [], mcp: [], knowledge_bases: [] } }))
  let created: { name?: string; path?: string; resources?: unknown } | null = null
  let instructions: { instructions?: string } | null = null
  let migrated: { path?: string } | null = null
  await page.route('**/api/settings/workspace/registrations/migrate-root?*', route => {
    migrated = route.request().postDataJSON()
    return route.fulfill({ json: { root: migrated?.path, workspaces: [] } })
  })
  await page.route('**/api/settings/workspace/registrations/w1?*', route => {
    instructions = route.request().postDataJSON()
    return route.fulfill({ json: { workspace: { workspace_id: 'w1', display_name: 'Research', kind: 'workspace', follows_root: true, path: '/root/w1', archived: false, status: 'ready', error: '', instructions: instructions?.instructions } } })
  })
  await page.route('**/api/settings/workspace/registrations?*', route => {
    if (route.request().method() === 'POST') {
      created = route.request().postDataJSON()
      return route.fulfill({ json: { workspace: created } })
    }
    return route.fulfill({ json: { root: '/root', workspaces: [{ workspace_id: 'w1', display_name: 'Research', kind: 'workspace', follows_root: true, path: '/root/w1', archived: false, status: 'ready', error: '', instructions: '' }] } })
  })
  await page.goto('/settings/workspace')
  await page.getByRole('button', { name: '新建工作区', exact: true }).click()
  await page.getByLabel('工作区名称').fill('Physics')
  await page.getByLabel('现有目录（可选）').fill('/tmp/physics')
  await page.getByRole('button', { name: '创建工作区', exact: true }).click()
  expect(created?.name).toBe('Physics')
  expect(created?.path).toBe('/tmp/physics')
  await page.getByRole('button', { name: '工作区说明', exact: true }).click()
  await page.locator('.workspace-inline-form textarea').fill('Explain carefully')
  const instructionsResponse = page.waitForResponse('**/api/settings/workspace/registrations/w1?*')
  const catalogResponse = page.waitForResponse('**/api/settings/workspace/registrations?*')
  await page.locator('.workspace-inline-form').getByRole('button', { name: '保存', exact: true }).click()
  await instructionsResponse
  await catalogResponse
  expect(instructions?.instructions).toBe('Explain carefully')
  await expect(page.getByText('工作区已更新', { exact: true })).toBeVisible()
  await page.getByLabel('工作区根目录').fill('/new-root')
  await page.getByRole('button', { name: '迁移到新根目录' }).click()
  await expect.poll(() => migrated?.path).toBe('/new-root')
})
