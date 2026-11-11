import { expect, test } from '@playwright/test'

test('chat composer accepts picker, paste and drop with shared validation and image previews', async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/settings/chat-attachments') return route.fulfill({ json: { effective: { max_file_bytes: 10, max_total_bytes: 20 } } })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [] } })
    if (path === '/api/capabilities/registered') return route.fulfill({ json: [{ id: 'chat', available: true }] })
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/chat')
  await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', /image\/\*.*\.pdf/)
  await expect(page.locator('textarea')).toHaveAttribute('maxlength', '32000')
  await page.locator('input[type="file"]').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.locator('.pending-attachment')).toHaveCount(1)

  await page.locator('textarea').evaluate(element => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['123456'], 'pixel.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.pending-attachment')).toHaveCount(2)
  await expect(page.locator('.pending-attachment-preview img')).toHaveCount(1)

  await page.locator('form.composer').evaluate(element => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['export'], 'code.ts', { type: 'text/typescript' }))
    element.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.composer-drop-overlay')).toBeVisible()
  await page.locator('form.composer').evaluate(element => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['export'], 'code.ts', { type: 'text/typescript' }))
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.pending-attachment')).toHaveCount(3)
  await expect(page.locator('.composer-drop-overlay')).toHaveCount(0)

  await page.locator('input[type="file"]').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') })
  await expect(page.locator('.composer-attachment-error')).toContainText('不支持的文件类型')
  await page.locator('input[type="file"]').setInputFiles({ name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.from('12345678901') })
  await expect(page.locator('.composer-attachment-error')).toContainText('文件过大')
  await page.locator('input[type="file"]').setInputFiles({ name: 'quota.txt', mimeType: 'text/plain', buffer: Buffer.from('123456') })
  await expect(page.locator('.composer-attachment-error')).toContainText('附件总大小超出限制')
  await expect(page.locator('.pending-attachment')).toHaveCount(3)

  await page.locator('.pending-attachment-preview:has(img)').click()
  await expect(page.getByRole('dialog', { name: '附件预览' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '附件预览' }).locator('img')).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.pending-attachment-remove').first().click()
  await expect(page.locator('.pending-attachment')).toHaveCount(2)
})
