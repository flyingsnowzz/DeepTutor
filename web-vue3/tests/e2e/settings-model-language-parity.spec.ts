import { expect, test } from '@playwright/test'

test('model catalog controls follow the applied English language', async ({ page }) => {
  const catalog = { connections: [{ id: 'connection-a', name: 'Provider A', provider: 'openai', binding: 'openai', base_url: 'https://example.test', api_key: '' }], services: {
    llm: { active_profile_id: 'profile-a', active_model_id: 'model-a', profiles: [{ id: 'profile-a', name: 'Profile A', provider: 'openai', binding: 'openai', base_url: 'https://example.test', models: [{ id: 'model-a', model: 'gpt-test' }] }] },
    task: { mode: 'inherit', active_profile_id: null, active_model_id: null, profiles: [], overrides: {} },
    tts: { active_profile_id: null, active_model_id: null, profiles: [] },
    stt: { active_profile_id: null, active_model_id: null, profiles: [] },
    imagegen: { active_profile_id: null, active_model_id: null, profiles: [] },
    videogen: { active_profile_id: null, active_model_id: null, profiles: [] },
  } }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog, task_kinds: [], providers: { llm: [{ value: 'openai', label: 'OpenAI', default_api_format: 'openai_chat' }] } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/test-provider*', route => route.fulfill({ json: { status: 'connected', models: [{ id: 'gpt-test' }, { id: 'gpt-new' }] } }))
  await page.goto('/settings/connections')
  await expect(page.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add provider' })).toBeVisible()
  await page.getByRole('button', { name: 'Add provider' }).click()
  await expect(page.getByRole('heading', { name: 'Add provider' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Provider type' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'OpenAI' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await page.locator('a[href="/settings/llm"]').first().click()
  await expect(page.getByRole('heading', { name: 'Language models' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Models in this profile' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Test model' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Model display name' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Context window (tokens)' })).toBeVisible()
  await expect(page.getByText('Reasoning effort', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Test provider connection' }).click()
  await expect(page.getByText('Connected. The provider returned 2 models.')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Choose a model from this provider' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add selected models' })).toBeDisabled()
  await page.locator('a[href="/settings/task-models"]').first().click()
  await expect(page.getByRole('heading', { name: 'Global task model' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Background task model' })).toContainText('Follow the chat model')
  await page.locator('a[href="/settings/multimodal"]').first().click()
  await expect(page.getByRole('heading', { name: 'Multimodal generation' })).toBeVisible()
})
