import { expect, test } from '@playwright/test'

test('knowledge files use the legacy tree, preview, folder, move and delete workflow', async ({ page }) => {
  const files: Array<{ name: string; type: 'file' | 'folder'; size?: number }> = [
    { name: 'docs', type: 'folder' },
    { name: 'docs/guide.txt', type: 'file', size: 12 },
  ]
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [{ name: 'kb1', status: 'ready' }] }))
  await page.route('**/api/knowledge-bases/kb1?*', route => route.fulfill({ json: { name: 'kb1', status: 'ready', metadata: { rag_provider: 'llamaindex' }, statistics: {} } }))
  await page.route('**/api/knowledge-bases/kb1/files?*', route => route.fulfill({ json: { files } }))
  await page.route('**/api/knowledge-bases/kb1/progress?*', route => route.fulfill({ json: { stage: 'completed', percent: 100 } }))
  await page.route('**/api/knowledge-bases/kb1/file-preview-text/docs/guide.txt?*', route => route.fulfill({ json: { text: 'Preview text' } }))
  await page.route('**/api/knowledge-bases/kb1/folders?*', route => {
    const path = route.request().postDataJSON().path
    files.push({ name: path, type: 'folder' })
    return route.fulfill({ json: {} })
  })
  await page.route('**/api/knowledge-bases/kb1/files/move?*', route => {
    const body = route.request().postDataJSON()
    const file = files.find(item => item.name === body.source)!
    file.name = `${body.dest_folder ? `${body.dest_folder}/` : ''}${body.source.split('/').pop()}`
    return route.fulfill({ json: {} })
  })
  await page.route('**/api/knowledge-bases/kb1/files/Planning/guide.txt?*', route => {
    const index = files.findIndex(item => item.name === 'Planning/guide.txt')
    if (index >= 0) files.splice(index, 1)
    return route.fulfill({ json: {} })
  })
  await page.goto('/knowledge-bases/kb1')
  await expect(page.locator('.kb-preview-empty')).toContainText('选择文件进行预览')
  await page.getByRole('button', { name: 'docs/guide.txt', exact: true }).click()
  await expect(page.locator('.kb-preview-content pre')).toHaveText('Preview text')
  await page.getByRole('button', { name: '折叠文件列表', exact: true }).first().click()
  await expect(page.locator('.kb-files-collapsed')).toBeVisible()
  await page.getByRole('button', { name: '展开文件列表', exact: true }).first().click()
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click()
  await page.getByLabel('文件夹名称').fill('Planning')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('button', { name: /Planning/ })).toBeVisible()
  const row = page.locator('.kb-tree-row').filter({ has: page.getByRole('button', { name: 'docs/guide.txt', exact: true }) })
  await row.hover()
  await row.getByRole('button', { name: '移动 docs/guide.txt', exact: true }).click()
  await page.getByLabel('移动到 docs/guide.txt').selectOption('Planning')
  await expect(page.getByRole('button', { name: 'Planning/guide.txt', exact: true })).toBeVisible()
  const moved = page.locator('.kb-tree-row').filter({ has: page.getByRole('button', { name: 'Planning/guide.txt', exact: true }) })
  await moved.hover()
  await moved.getByRole('button', { name: '删除 Planning/guide.txt', exact: true }).click()
  await moved.getByRole('button', { name: '确认删除 Planning/guide.txt', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Planning/guide.txt', exact: true })).toHaveCount(0)
})
