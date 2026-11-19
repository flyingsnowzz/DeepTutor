import { expect, test, type Page } from '@playwright/test'

async function openSettings(page: Page, account: Record<string, unknown>) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: account }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto('/settings/general')
}

async function openDirectSettings(page: Page, account: Record<string, unknown>, section: string) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: account }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.goto(`/settings/${section}`)
}

async function expectUnavailable(page: Page) {
  await expect(page.getByRole('heading', { name: 'This settings page is unavailable.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to settings' })).toHaveAttribute('href', '/settings/general')
}

test('administrator navigation includes the React settings leaves', async ({ page }) => {
  await openSettings(page, { enabled: true, authenticated: true, is_admin: true })
  const nav = page.getByRole('navigation', { name: '设置分区' })
  await expect(nav.getByRole('link', { name: '附件' })).toBeVisible()
  await expect(nav.getByRole('link', { name: '视频学习' })).toBeVisible()
  await expect(nav.getByRole('link', { name: '伙伴与智能体' })).toBeVisible()
  await expect(nav.getByRole('link', { name: '学习档案' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: '监护管理' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: '搜索设置' }).fill('Codex')
  await expect(nav.getByRole('link', { name: 'Codex', exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索设置' }).fill('Providers')
  await expect(nav.getByRole('link', { name: '提供方', exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索设置' }).fill('Codex')
  await nav.getByRole('link', { name: 'Codex', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/agent-codex$/)
  await page.getByRole('searchbox', { name: '搜索设置' }).fill('')
  await nav.getByRole('link', { name: '附件' }).click()
  await expect(page).toHaveURL(/\/settings\/attachments$/)
  await expect(page.getByRole('heading', { name: '附件' })).toBeVisible()
})

test('ordinary account visibility matches learner and guardian presets', async ({ page }) => {
  await openSettings(page, { enabled: true, authenticated: true, is_admin: false, preset: 'standard' })
  const nav = page.getByRole('navigation', { name: '设置分区' })
  await expect(nav.getByRole('link', { name: '附件' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: '视频学习' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: '伙伴与智能体' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: '搜索设置' }).fill('Codex')
  await expect(nav.getByRole('link', { name: 'Codex', exact: true })).toHaveCount(0)
  await page.getByRole('searchbox', { name: '搜索设置' }).fill('')
  await expect(nav.getByRole('link', { name: '监护管理' })).toBeVisible()
  await expect(nav.getByRole('link', { name: '学习档案' })).toHaveCount(0)
})

test('learner account shows its own profile without guardian entry', async ({ page }) => {
  await openSettings(page, { enabled: true, authenticated: true, is_admin: false, preset: 'learner' })
  const nav = page.getByRole('navigation', { name: '设置分区' })
  await expect(nav.getByRole('link', { name: '学习档案' })).toBeVisible()
  await expect(nav.getByRole('link', { name: '监护管理' })).toHaveCount(0)
})

test('direct route access enforces the same access matrix as the React settings shell', async ({ page }) => {
  await openDirectSettings(page, { enabled: false, authenticated: true, is_admin: true }, 'learner-profile')
  await expectUnavailable(page)

  await openDirectSettings(page, { enabled: false, authenticated: true, is_admin: true }, 'guardian')
  await expectUnavailable(page)

  await openDirectSettings(page, { enabled: true, authenticated: true, is_admin: false, preset: 'standard' }, 'attachments')
  await expectUnavailable(page)

  await openDirectSettings(page, { enabled: true, authenticated: true, is_admin: false, preset: 'standard' }, 'agent-codex')
  await expectUnavailable(page)

  await openDirectSettings(page, { enabled: true, authenticated: true, is_admin: false, preset: 'standard' }, 'learner-profile')
  await expectUnavailable(page)

  await openDirectSettings(page, { enabled: true, authenticated: true, is_admin: false, preset: 'learner' }, 'guardian')
  await expectUnavailable(page)
})
