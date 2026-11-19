import { expect, test } from '@playwright/test'

test('model and general settings share one draft across sections and reload', async ({ page }) => {
  const catalog = { services: { llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ id: 'p1', name: 'Provider', provider: 'openai', models: [{ id: 'm1', model: 'gpt-test', name: 'Test' }] }] } } }
  let stored: any = null
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { catalog, ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => {
    if (route.request().method() === 'PUT') stored = route.request().postDataJSON()
    if (route.request().method() === 'DELETE') stored = null
    return route.fulfill({ json: { draft: stored } })
  })
  await page.goto('/settings/llm')
  await page.getByLabel('新模型 ID').fill('model-two')
  await page.getByRole('button', { name: '添加模型', exact: true }).last().click()
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '常规' }).click()
  await page.getByRole('combobox', { name: '模型输出语言' }).selectOption('en')
  await page.getByRole('button', { name: '存草稿' }).click()
  await expect.poll(() => stored?.catalog?.services?.llm?.profiles?.[0]?.models?.length).toBe(2)
  expect(stored.extensions.ui.response_language).toBe('en')
  await page.reload()
  await expect(page.getByRole('combobox', { name: '模型输出语言' })).toHaveValue('en')
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '语言模型' }).click()
  await expect(page.getByText('model-two', { exact: true }).first()).toBeVisible()
})
