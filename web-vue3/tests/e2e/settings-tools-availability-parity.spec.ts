import { expect, test } from '@playwright/test'

test('unavailable search tool explains configuration and links to search settings', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/tools*', route => route.fulfill({ json: { enabled_optional_tools: ['web_search'], tools: [{ name: 'web_search', description: 'Search', parameters: [], hints: { en: { short_description: 'Search the web', when_to_use: '', input_format: '', guideline: '', note: '', aliases: [] } }, aliases: [], toggleable: true, enabled: true, available: false, unavailable_reason: 'search_provider_not_configured' }] } }))
  await page.goto('/settings/tools')
  await expect(page.getByText('请先在搜索设置中选择提供商。')).toBeVisible()
  await expect(page.getByRole('switch', { name: '未配置' })).toBeDisabled()
  await expect(page.getByRole('link', { name: '打开设置' })).toHaveAttribute('href', '/settings/search')
})

test('tools page follows English interface language and searches alternate hints', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/tools*', route => route.fulfill({ json: { enabled_optional_tools: ['web_search'], tools: [{
    name: 'web_search', description: 'Search', parameters: [{ name: 'query', type: 'string', description: 'Search phrase', required: false }],
    hints: {
      en: { short_description: 'Search the web', when_to_use: 'Find current facts', input_format: 'query', guideline: '', note: '', aliases: [] },
      zh: { short_description: '联网搜索', when_to_use: '查询最新资料', input_format: '', guideline: '', note: '', aliases: [{ name: '查找资料', description: '查找资料', phase: 'search' }] },
    },
    aliases: [], toggleable: true, enabled: true, available: false, unavailable_reason: 'search_provider_not_configured',
  }] } }))
  await page.goto('/settings/tools')
  await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Experience Enhancement' })).toBeVisible()
  await expect(page.getByText('Search the web')).toBeVisible()
  await expect(page.getByText('Choose a provider in Search settings first. DuckDuckGo needs no API key.')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Not configured' })).toBeDisabled()
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('查找资料')
  await expect(page.getByText('Search the web')).toBeVisible()
  await page.getByRole('button', { name: /web_search/ }).click()
  await expect(page.getByRole('heading', { name: 'When to use' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Parameters' })).toBeVisible()
})
