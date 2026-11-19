import { expect, test } from '@playwright/test'

test('provider connection exposes protocol and advanced fields and protects referenced connections', async ({ page }) => {
  const catalog = {
    connections: [{ id: 'c1', name: 'Provider A', provider: 'openai', binding: 'openai', base_url: 'https://example.test', api_key: '', api_format: 'openai_chat', extra_headers: { 'X-Org': 'old' } }],
    services: { llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', name: 'Profile A', provider: 'openai', models: [{ id: 'm1', model: 'gpt-test', provider_ref: { connection_id: 'c1' } }] }] } },
  }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog, task_kinds: [], providers: { llm: [{ value: 'openai', label: 'OpenAI' }], imagegen: [{ value: 'custom', label: 'Custom' }] } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/test-provider*', route => route.fulfill({ json: { status: 'connected', models: [], capabilities: [{ category: 'embedding', evidence: 'metadata' }] } }))
  await page.goto('/settings/connections')
  await expect(page.getByRole('button', { name: 'Remove provider' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove provider' })).toHaveAttribute('title', 'Change or remove the models using this provider first.')
  await page.getByText('Advanced connection settings').click()
  await expect(page.getByRole('textbox', { name: 'Extra headers (JSON)' })).toHaveValue('{"X-Org":"old"}')
  await page.getByRole('textbox', { name: 'Extra headers (JSON)' }).fill('{"X-Org":"new"}')
  const services = page.getByRole('region', { name: 'Available service types' })
  await expect(services.getByRole('checkbox', { name: 'Language models' })).toBeChecked()
  await services.getByRole('checkbox', { name: 'Image Generation' }).check()
  await expect(services.getByRole('button', { name: 'Use detected and built-in types' })).toBeVisible()
  await page.getByRole('button', { name: 'Test provider connection' }).click()
  await expect(page.getByText('Provider connected · 0 models available')).toBeVisible()
  await expect(page.getByText('Embedding models')).toBeVisible()
  await page.getByRole('combobox', { name: 'API protocol' }).selectOption('openai_responses')
  await expect(page.getByText('Provider connected · 0 models available')).toHaveCount(0)
  await expect(page.getByText('Embedding models')).toHaveCount(0)
  await page.getByRole('button', { name: 'Test provider connection' }).click()
  await expect(page.getByText('Provider connected · 0 models available')).toBeVisible()
  await expect(page.getByText('Embedding models')).toBeVisible()
})

test('custom provider wizard validates URL and creates a complete connection', async ({ page }) => {
  const catalog = { connections: [], services: {} }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog, task_kinds: [], providers: { llm: [{ value: 'custom', label: 'Custom' }] } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto('/settings/connections')
  await page.getByRole('button', { name: 'Add provider' }).click()
  await page.getByRole('radio', { name: 'Custom' }).check()
  await page.getByRole('textbox', { name: 'Custom provider name' }).fill('My gateway')
  await page.getByRole('textbox', { name: 'Provider URL' }).fill('ftp://example.test')
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Provider URL' }).fill('https://example.test/v1')
  await page.getByRole('combobox', { name: 'API protocol' }).selectOption('anthropic')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'My gateway' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'API protocol' })).toHaveValue('anthropic')
  await expect(page.getByRole('textbox', { name: 'Provider URL' })).toBeVisible()
  await expect(page.getByText('Custom (Anthropic Messages)')).toBeVisible()
})

test('provider rail and service matrix follow React registry state', async ({ page }) => {
  const catalog = {
    connections: [
      { id: 'c1', name: 'Gateway', provider: 'custom', source_service: 'llm', base_url: 'https://gateway.test/v1', api_key: 'secret', api_format: 'openai_chat' },
      { id: 'c2', name: 'Search only', provider: 'brave', source_service: 'search', base_url: '', api_key: 'secret' },
    ],
    services: {
      llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', name: 'Profile A', provider: 'custom', models: [{ id: 'm1', model: 'gpt-test', provider_ref: { connection_id: 'c1' } }] }] },
    },
  }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: {
    ui: { language: 'en' },
    catalog,
    task_kinds: [],
    providers: {
      llm: [{ value: 'custom', label: 'Custom' }],
      search: [{ value: 'brave', label: 'Brave Search' }],
    },
    connection_targets: [{ provider: 'brave', services: { search: true } }],
  } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto('/settings/connections')
  await expect(page.getByRole('button', { name: /Gateway 1 configured models Language models/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('No models configured yet.')).toHaveCount(0)
  await expect(page.getByText('Custom (OpenAI API)')).toBeVisible()
  const services = page.getByRole('region', { name: 'Available service types' })
  await expect(services.getByRole('button', { name: 'Use detected and built-in types' })).toHaveCount(0)
  await expect(services.getByRole('checkbox', { name: 'Search' })).not.toBeChecked()
  await services.getByRole('checkbox', { name: 'Search' }).check()
  await expect(services.getByRole('button', { name: 'Use detected and built-in types' })).toBeVisible()
  await page.getByRole('button', { name: 'Use detected and built-in types' }).click()
  await expect(services.getByRole('button', { name: 'Use detected and built-in types' })).toHaveCount(0)
  await expect(services.getByRole('checkbox', { name: 'Search' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Add provider' }).click()
  await expect(page.getByRole('group', { name: 'Filter provider types' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Images' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Video' })).toBeVisible()
})

test('provider query parameter selects the matching connection', async ({ page }) => {
  const catalog = {
    connections: [
      { id: 'c1', name: 'First', provider: 'openai', source_service: 'llm', base_url: 'https://first.test', api_key: '' },
      { id: 'c2', name: 'Second', provider: 'custom', source_service: 'llm', base_url: 'https://second.test', api_key: '', api_format: 'openai_chat' },
    ],
    services: {},
  }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog, task_kinds: [], providers: { llm: [{ value: 'custom', label: 'Custom' }, { value: 'openai', label: 'OpenAI' }] } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto('/settings/connections?provider=connection%3Ac2')
  await expect(page.getByRole('button', { name: /Second/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('textbox', { name: 'Provider URL' })).toHaveValue('https://second.test')
})

test('Codex provider choice opens its OAuth card', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog: { connections: [], services: {} }, task_kinds: [], providers: { llm: [{ value: 'openai_codex', label: 'OpenAI Codex' }] } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/providers/openai-codex/oauth/status*', route => route.fulfill({ json: { connection: 'disconnected', operation_state: 'idle', models: [] } }))
  await page.goto('/settings/connections')
  await page.getByRole('button', { name: 'Add provider' }).click()
  await page.getByRole('radio', { name: 'OpenAI Codex' }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('OpenAI Codex 登录')).toBeVisible()
  await expect(page.getByRole('button', { name: '登录 Codex' })).toBeVisible()
})

test('built-in provider probe uses its default endpoint when the URL is blank', async ({ page }) => {
  const catalog = { connections: [{ id: 'c1', name: 'Provider A', provider: 'openai', source_service: 'llm', base_url: '', api_key: 'test', api_format: 'openai_responses' }], services: {} }
  let probe: Record<string, unknown> | null = null
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog, task_kinds: [], providers: { llm: [{ value: 'openai', label: 'OpenAI', base_url: 'https://chat.example/v1', base_urls: { openai_responses: 'https://responses.example/v1' }, api_formats: ['openai_chat', 'openai_responses'], default_api_format: 'openai_chat' }] } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/test-provider*', route => { probe = route.request().postDataJSON(); return route.fulfill({ json: { status: 'connected', models: [] } }) })
  await page.goto('/settings/connections')
  await expect(page.getByRole('textbox', { name: 'Provider URL' })).toHaveAttribute('placeholder', 'https://responses.example/v1')
  await page.getByRole('button', { name: 'Test provider connection' }).click()
  await expect(page.getByText('Provider connected · 0 models available')).toBeVisible()
  expect(probe?.base_url).toBe('https://responses.example/v1')
  await expect(page.getByRole('combobox', { name: 'API protocol' }).locator('option[value="anthropic"]')).toHaveCount(0)
})
