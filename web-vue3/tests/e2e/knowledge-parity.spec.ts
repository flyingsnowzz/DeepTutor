import { expect, test } from '@playwright/test'

test('knowledge detail restores source tabs and performs folder, GitHub and settings actions', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [{ name: 'kb1', status: 'ready', is_default: false }] }))
  await page.route('**/api/knowledge-bases/kb1?*', route => route.fulfill({ json: { name: 'kb1', status: 'ready', is_default: false, metadata: { rag_provider: 'llamaindex' }, statistics: { raw_documents: 1, rag_provider: 'llamaindex', index_versions: [] } } }))
  await page.route('**/api/knowledge-bases/kb1/files?*', route => route.fulfill({ json: { files: [{ name: 'guide.txt', type: 'file' }] } }))
  await page.route('**/api/knowledge-bases/kb1/progress?*', route => route.fulfill({ json: { stage: 'completed', percent: 100 } }))
  const folders: { id: string; path: string; added_at: string; file_count: number; last_sync: string | null }[] = []
  await page.route('**/api/knowledge-bases/kb1/linked-folders?*', route => route.fulfill({ json: folders }))
  await page.route('**/api/knowledge-bases/kb1/link-folder?*', route => {
    const body = route.request().postDataJSON()
    folders.push({ id: 'f1', path: body.folder_path, added_at: '2026-01-01', file_count: 1, last_sync: null })
    return route.fulfill({ json: folders[0] })
  })
  const sources: { id: string; repo: string; branch: string; path: string; glob: string; files_synced: number }[] = []
  await page.route('**/api/knowledge-bases/kb1/github-sources?*', route => route.fulfill({ json: sources }))
  await page.route('**/api/knowledge-bases/kb1/github-source?*', route => {
    const body = route.request().postDataJSON()
    sources.push({ id: 'g1', ...body, files_synced: 0 })
    return route.fulfill({ json: sources[0] })
  })
  await page.route('**/api/knowledge-bases/default/kb1?*', route => route.fulfill({ json: {} }))
  await page.goto('/knowledge-bases/kb1')
  await expect(page.locator('.kb-detail-tabs button')).toHaveCount(7)
  await page.getByRole('button', { name: '关联文件夹', exact: true }).click()
  await page.getByLabel('文件夹路径').fill('/demo/docs')
  await page.getByRole('button', { name: '关联文件夹', exact: true }).last().click()
  await expect(page.getByText('/demo/docs', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'GitHub', exact: true }).click()
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await page.getByLabel('仓库（owner/repo）').fill('deep/docs')
  await page.getByRole('button', { name: '添加并同步', exact: true }).click()
  await expect(page.getByText('deep/docs', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: /设为默认/ }).click()
  await expect(page.getByText('已设为默认知识库')).toBeVisible()
})
