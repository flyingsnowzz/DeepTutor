import { expect, test } from '@playwright/test'

const partner = {
  partner_id: 'p1', name: 'Researcher', description: 'Finds sources', emoji: '🦉', color: '#6d5a8c', running: true, can_manage: true, channels: [],
}

async function mockPartner(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/partners/p1?*', route => route.fulfill({ json: partner }))
  await page.route('**/api/partners/p1/sessions?*', route => route.fulfill({ json: [{ session_key: 'default', title: 'Current research', archived: false, updated_at: new Date().toISOString() }] }))
  await page.route('**/api/partners/p1/history?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/partners/p1/web-continuity?*', route => route.fulfill({ json: { enabled: false, session_key: 'default' } }))
  await page.route('**/api/partners/p1/links?*', route => route.fulfill({ json: [] }))
}

test('partner detail restores the page-bar header and compact composer geometry', async ({ page }) => {
  await mockPartner(page)
  await page.goto('/partners/p1')
  const header = page.locator('.partner-direct-header')
  await expect(header.locator('.partner-crumb-root')).toContainText('伙伴')
  await expect(header.locator('.partner-crumb-separator')).toHaveText('/')
  await expect(header.locator('.partner-crumb-current')).toContainText('Researcher')
  await expect(header.getByRole('tab')).toHaveText(['聊天', '配置', '频道', '历史记录'])
  await expect(header.getByRole('tab').first()).toHaveCSS('height', '28px')
  await expect(header.getByRole('button', { name: '跨浏览器同步' })).toHaveCSS('width', '117px')
  await expect(header.getByRole('button', { name: '归档' })).toHaveCSS('width', '33px')
  await expect(header.getByRole('button', { name: '归档' })).toHaveCSS('height', '30px')

  const composer = page.locator('.partner-direct-composer')
  expect((await composer.boundingBox())?.width).toBe(664)
  expect((await composer.boundingBox())?.height).toBe(77)
  const textarea = composer.getByRole('textbox', { name: '输入消息' })
  expect((await textarea.boundingBox())?.height).toBe(39)
  await expect(composer.getByRole('button', { name: '附加文件' })).toHaveCSS('width', '28px')
  await expect(composer.getByRole('button', { name: '提示' })).toHaveCSS('height', '28px')
  await expect(composer.getByRole('button', { name: '发送' })).toHaveCSS('width', '28px')
  await expect(composer.getByRole('button', { name: '发送' })).toBeDisabled()

  await composer.getByRole('button', { name: '提示' }).hover()
  await expect(composer.locator('.partner-composer-tip-panel')).toContainText('输入 / 查看命令')
})

test('partner composer uploads an attachment and sends it in the stream body', async ({ page }) => {
  await mockPartner(page)
  let sent: any = null
  await page.route('**/api/partners/p1/chat/execute-stream*', async route => {
    sent = route.request().postDataJSON()
    await route.fulfill({ contentType: 'text/event-stream', body: 'event: content\ndata: {"content":"Received"}\n\n' })
  })
  await page.goto('/partners/p1')
  const composer = page.locator('.partner-direct-composer')
  await composer.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(composer.locator('.partner-pending-attachment')).toContainText('notes.txt')
  await composer.getByRole('textbox', { name: '输入消息' }).fill('Summarize this')
  await composer.getByRole('button', { name: '发送' }).click()
  await expect.poll(() => sent).toMatchObject({
    content: 'Summarize this',
    session_key: 'default',
    attachments: [{ type: 'file', filename: 'notes.txt', base64: 'aGVsbG8=', mime_type: 'text/plain' }],
  })
  await expect(composer.locator('.partner-pending-attachment')).toHaveCount(0)
})
