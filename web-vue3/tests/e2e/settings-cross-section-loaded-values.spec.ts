import { expect, test } from '@playwright/test'

test('conversation and attachment values load from server while another section has a draft', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', response_language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: null } : {} }))
  await page.route('**/api/settings/chat-starters*', route => route.fulfill({ json: { settings: { trace_count: 47 }, bounds: { trace_count: [3, 100] } } }))
  await page.route('**/api/settings/chat-attachments*', route => route.fulfill({ json: { settings: { max_file_mb: 64, max_total_mb: 90, max_chars_per_doc: 310000, max_chars_total: 480000 }, bounds: { max_file_mb: [1, 1024], max_total_mb: [1, 2048], chars: [10000, 5000000] }, effective: { ws_max_size: 104857600, max_file_bytes: 67108864, max_total_bytes: 94371840 } } }))
  await page.goto('/settings/general')
  await page.getByRole('combobox', { name: '模型输出语言' }).selectOption('en')
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '对话' }).click()
  await expect(page.getByRole('spinbutton', { name: '近期活动条数' })).toHaveValue('47')
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '附件' }).click()
  await expect(page.getByRole('spinbutton', { name: '单文件上限（MB）' })).toHaveValue('64')
  await expect(page.getByRole('spinbutton', { name: '每条消息总上限（MB）' })).toHaveValue('90')
  await expect(page.getByRole('spinbutton', { name: '单文档字符上限' })).toHaveValue('310000')
  await expect(page.getByRole('spinbutton', { name: '每条消息字符上限' })).toHaveValue('480000')
})
