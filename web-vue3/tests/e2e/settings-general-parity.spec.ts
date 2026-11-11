import { expect, test } from '@playwright/test'

test('general settings includes the legacy agent setup dialog and navigation', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { catalog: {}, ui: { theme: 'snow', language: 'zh', response_language: 'zh' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
  })
  await page.goto('/settings/general')
  await expect(page.getByRole('link', { name: '监护管理' })).toBeVisible()
  await expect(page.getByRole('link', { name: '附件', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '视频学习', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '伙伴与智能体', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '让你的 Agent 帮你配置' }).click()
  const dialog = page.getByRole('dialog', { name: '让你的 Agent 帮你配置' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('width', '600px')
  await expect(dialog.getByRole('button', { name: '复制提示词' })).toBeVisible()
  await expect.poll(() => dialog.getByRole('button', { name: '复制提示词' }).evaluate(button => getComputedStyle(button).backgroundColor)).not.toBe('rgb(255, 255, 255)')
  await expect(dialog.getByRole('textbox')).toHaveValue(/docs-for-dev\/AGENT_SETUP.md/)
  await dialog.getByRole('button', { name: '复制提示词' }).click()
  await expect(dialog.getByRole('status')).toHaveText('已复制')
})
