import { expect, test } from '@playwright/test'

test('preset stages the current catalog and extensions and refreshes the shared draft', async ({ page }) => {
  const catalog = { services: { llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', name: 'Provider', provider: 'openai', models: [{ id: 'm1', model: 'gpt-test', name: 'Test' }] }] } } }
  let submitted: any = null
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { catalog, ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/presets**', route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON()
      return route.fulfill({ json: { draft: { catalog: submitted.catalog, extensions: { ...submitted.extensions, tools: { enabled_tools: ['reason'] } } } } })
    }
    return route.fulfill({ json: { schema_version: '1', presets: [{ id: 'basic_text', label: '', description: '', parser: 'markitdown', resource_cost: 'low', credentials: [], prerequisites: [], unlocked_features: [] }] } })
  })
  await page.goto('/settings/llm')
  await page.getByLabel('新模型 ID').fill('model-two')
  await page.getByRole('button', { name: '添加模型', exact: true }).last().click()
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '常规' }).click()
  await page.getByRole('combobox', { name: '模型输出语言' }).selectOption('en')
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '配置起点' }).click()
  await page.getByRole('button', { name: '加载草稿' }).click()
  await expect.poll(() => submitted?.catalog?.services?.llm?.profiles?.[0]?.models?.length).toBe(2)
  expect(submitted.extensions.ui.response_language).toBe('en')
  await expect(page.locator('.legacy-settings-toolbar')).toContainText('草稿尚未应用')
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '工具' }).click()
  await expect(page.locator('.legacy-settings-toolbar')).toContainText('草稿尚未应用')
})
