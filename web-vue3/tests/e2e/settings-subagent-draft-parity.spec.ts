import { expect, test } from '@playwright/test'

test('subagent edits are staged and applied through the settings toolbar', async ({ page }) => {
  const applied: unknown[] = []
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/subagents/backends/options*', route => route.fulfill({ json: { backends: [{ kind: 'codex', display_name: 'Codex', available: true, models: [{ slug: 'gpt-test', display_name: 'GPT Test', efforts: ['high'] }], efforts: ['high'] }] } }))
  await page.route('**/api/subagents/settings*', async route => {
    if (route.request().method() === 'PUT') applied.push(route.request().postDataJSON())
    await route.fulfill({ json: { backends: { codex: { model: '', effort: '', enabled: true } } } })
  })
  await page.goto('/settings/agent-codex')
  await page.getByRole('combobox', { name: '智能体模型' }).selectOption('gpt-test')
  await page.getByRole('combobox', { name: '智能体推理强度' }).selectOption('high')
  await expect(page.getByRole('button', { name: '应用更改' })).toBeVisible()
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '常规' }).click()
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en')
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('zh')
  await expect(page.getByRole('button', { name: '应用更改' })).toBeVisible()
  expect(applied).toEqual([])
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect.poll(() => applied.length).toBe(1)
  expect(applied[0]).toMatchObject({ backends: { codex: { model: 'gpt-test', effort: 'high' } } })
})
