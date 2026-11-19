import { expect, test } from '@playwright/test'

test('runtime status strip shows turn health and container memory pressure', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/readiness*', route => route.fulfill({ json: { ok: true, summary: { enabled_verified: 0, available_disabled: 0, unavailable: 0, misconfigured: 0, not_selected: 0 }, rows: [], notices: [] } }))
  await page.route('**/api/modules*', route => route.fulfill({ json: { modules: [] } }))
  await page.route('**/api/system/status*', route => route.fulfill({ json: { backend: { status: 'online' } } }))
  await page.route('**/api/system/runtime*', route => route.fulfill({ json: { runtime_status: { worker_count: 2, coordination_mode: 'redis', redis_configured: true, redis_status: 'ok', leader_healthy: true, recovery_backlog: 0 } } }))
  await page.route('**/api/system/memory*', route => route.fulfill({ json: { available: true, total_rss_bytes: 1073741824, limit_bytes: 2147483648, available_bytes: 1073741824, limit_source: 'cgroup', usage_ratio: 0.5, processes: [{ label: 'backend', count: 1, rss_bytes: 1073741824 }] } }))
  await page.goto('/settings/status')
  await expect(page.locator('.runtime-health-strip')).toContainText('轮次运行正常')
  await expect(page.locator('.status-strip')).toContainText('50% / 2.0 GB')
  await expect(page.locator('.status-strip')).toContainText('容器可用')
  await expect(page.locator('.status-strip')).toContainText('后端')
})

test('readiness actions follow catalog editability', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  let editable = false
  let savedDraft = false
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh' }, ...(editable ? { catalog: { services: {} } } : {}) } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: savedDraft ? { extensions: {} } : null } }))
  await page.route('**/api/settings/readiness*', route => route.fulfill({ json: {
    ok: true,
    summary: { enabled_verified: 0, available_disabled: 0, unavailable: 0, misconfigured: 1, not_selected: 0 },
    rows: [{ id: 'catalog.llm', section: 'catalog', label: 'catalog.llm', state: 'misconfigured', detail_code: 'missing', required: true }],
    notices: [{ code: 'not_configured', row_id: 'catalog.llm', section: 'catalog', severity: 'suggestion' }],
  } }))
  await page.route('**/api/modules*', route => route.fulfill({ json: { modules: [] } }))
  await page.route('**/api/system/status*', route => route.fulfill({ json: { backend: { status: 'online' } } }))
  await page.route('**/api/system/runtime*', route => route.fulfill({ json: { runtime_status: {} } }))
  await page.route('**/api/system/memory*', route => route.fulfill({ json: { available: false } }))

  await page.goto('/settings/status')
  await expect(page.locator('.status-readiness header button')).toBeDisabled()
  await expect(page.locator('.status-attention-row')).toHaveCount(2)
  await expect(page.locator('.status-attention a[href="/settings/llm"]')).toHaveCount(0)
  await expect(page.locator('.status-groups a[href="/settings/llm"]')).toHaveCount(1)

  editable = true
  savedDraft = true
  await page.reload()
  await expect(page.locator('.status-readiness header button')).toBeEnabled()
  await expect(page.locator('.status-attention a[href="/settings/llm"]')).toHaveCount(3)
  await expect(page.locator('.status-attention')).toContainText('未应用的改动')
  await expect(page.locator('.status-attention')).toContainText('有一份已保存的草稿等待应用')
  await expect(page.locator('.status-notices')).toHaveCount(0)
})

test('module failure does not hide readiness and can be retried', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh' }, catalog: { services: {} } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/readiness*', route => route.fulfill({ json: {
    ok: true, summary: { enabled_verified: 1, available_disabled: 0, unavailable: 0, misconfigured: 0, not_selected: 0 },
    rows: [], notices: [],
  } }))
  let modulesAvailable = false
  await page.route('**/api/modules*', route => route.fulfill(modulesAvailable
    ? { json: { modules: [{ id: 'core', installed: true, enabled: true, ready: true, issues: [] }] } }
    : { status: 503, json: { detail: 'Unavailable' } }))
  await page.route('**/api/system/status*', route => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }))
  await page.route('**/api/system/runtime*', route => route.fulfill({ json: { runtime_status: {} } }))
  await page.route('**/api/system/memory*', route => route.fulfill({ json: { available: false } }))

  await page.goto('/settings/status')
  await expect(page.locator('.status-readiness')).toContainText('1 项就绪')
  await expect(page.locator('.status-modules button')).toHaveText('重试')
  await expect(page.locator('.status-strip > div').first()).toContainText('检查中')
  modulesAvailable = true
  await page.locator('.status-modules button').click()
  await expect(page.locator('.status-module-table')).toContainText('core')
  await expect(page.locator('.status-modules button')).toHaveCount(0)
})

test('status page follows the applied English interface language', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog: { services: {} } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/readiness*', route => route.fulfill({ json: {
    ok: true, summary: { enabled_verified: 1, available_disabled: 0, unavailable: 0, misconfigured: 0, not_selected: 0 },
    rows: [{ id: 'catalog.llm', section: 'catalog', label: 'Chat model', state: 'enabled_verified', detail_code: '', required: true }], notices: [],
  } }))
  await page.route('**/api/modules*', route => route.fulfill({ json: { modules: [{ id: 'core', installed: true, enabled: true, ready: true, issues: [] }] } }))
  await page.route('**/api/system/status*', route => route.fulfill({ json: { backend: { status: 'online' } } }))
  await page.route('**/api/system/runtime*', route => route.fulfill({ json: { runtime_status: { worker_count: 1, coordination_mode: 'memory', redis_configured: false, redis_status: 'missing', leader_healthy: null, recovery_backlog: 0 } } }))
  await page.route('**/api/system/memory*', route => route.fulfill({ json: { available: true, total_rss_bytes: 1073741824, limit_bytes: 2147483648, available_bytes: 1073741824, limit_source: 'cgroup', usage_ratio: 0.5, processes: [{ label: 'backend', count: 1, rss_bytes: 1073741824 }] } }))

  await page.goto('/settings/status')
  await expect(page.getByRole('heading', { name: 'Runtime status' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Modules' })).toBeVisible()
  await expect(page.locator('.status-module-table')).toContainText('Installed')
  await expect(page.locator('.status-module-table')).toContainText('Yes')
  await expect(page.locator('.status-strip')).toContainText('System memory')
  await expect(page.locator('.status-strip')).toContainText('Turn runtime')
  await expect(page.getByRole('heading', { name: 'Readiness' })).toBeVisible()
  await expect(page.locator('.status-readiness')).toContainText('1 ready')
  await expect(page.locator('.status-groups')).toContainText('Chat model')
})

test('failed model test is shown only for the tested active selection', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  let activeModelId = 'model-a'
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh' }, catalog: { services: { llm: {
    active_profile_id: 'profile-a', active_model_id: activeModelId,
    profiles: [{ id: 'profile-a', binding: 'openai', models: [{ id: 'model-a', model: 'model-a' }, { id: 'model-b', model: 'model-b' }] }],
  } } } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/readiness*', route => route.fulfill({ json: {
    ok: true, summary: { enabled_verified: 1, available_disabled: 0, unavailable: 0, misconfigured: 0, not_selected: 0 },
    rows: [{ id: 'catalog.llm', section: 'catalog', label: 'Chat model', state: 'enabled_verified', detail_code: '', required: true }], notices: [],
  } }))
  await page.route('**/api/modules*', route => route.fulfill({ json: { modules: [] } }))
  await page.route('**/api/system/status*', route => route.fulfill({ json: { backend: { status: 'online' } } }))
  await page.route('**/api/system/runtime*', route => route.fulfill({ json: { runtime_status: {} } }))
  await page.route('**/api/system/memory*', route => route.fulfill({ json: { available: false } }))
  await page.addInitScript(() => sessionStorage.setItem('deeptutor.settings.diagnosticsResults.v1', JSON.stringify({ llm: {
    state: 'failed', message: 'Request failed', profileId: 'profile-a', modelId: 'model-a',
  } })))

  await page.goto('/settings/status')
  await expect(page.locator('.status-attention')).toContainText('上次连接测试失败')
  await expect(page.locator('.status-groups')).toContainText('需处理')
  await expect(page.locator('.status-groups .provider-icon img')).toHaveAttribute('src', '/provider-icons/openai.svg')
  await expect(page.locator('.status-row-model')).toContainText('model-a')
  activeModelId = 'model-b'
  await page.reload()
  await expect(page.locator('.status-attention')).toContainText('没有需要处理的项。')
  await expect(page.locator('.status-groups')).toContainText('就绪')
})
