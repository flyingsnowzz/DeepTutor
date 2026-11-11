import { expect, test } from '@playwright/test'

test('knowledge creation restores mode, engine, upload and link-existing controls', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/knowledge-bases/rag-providers?*', route => route.fulfill({ json: { providers: [
    { id: 'llamaindex', name: 'LlamaIndex', description: 'Local vector retrieval', configured: true, modes: ['local'], default_mode: 'local' },
    { id: 'graphrag', name: 'GraphRAG', description: 'Knowledge graph retrieval', configured: false, modes: ['local'], default_mode: 'local' },
  ] } }))
  await page.route('**/api/knowledge-bases/connect-folder?*', route => route.fulfill({ json: { name: 'account:kb:linked' } }))
  await page.route('**/api/knowledge-bases/rag-pipelines/model-options?*', route => route.fulfill({ json: { embedding: { active: { profile_id: 'p1', model_id: 'm1' }, options: [{ profile_id: 'p1', profile_name: 'Local Ollama', model_id: 'm1', label: 'qwen3-embedding:0.6b' }] } } }))
  await page.route('**/api/knowledge-bases/rag-pipelines/llamaindex/config?*', route => route.fulfill({ json: { retrieval_profile: 'hybrid', top_k: 5, chunk_size: 512, chunk_overlap: 50 } }))
  await page.goto('/knowledge-bases')
  const empty = page.locator('.knowledge-home-empty')
  await expect(empty.locator('>svg')).toHaveAttribute('width', '24')
  await expect(empty.locator('h3')).toHaveCSS('font-size', '13px')
  await expect(empty.locator('h3')).toHaveCSS('font-weight', '500')
  await page.getByRole('button', { name: '新建知识库', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '创建知识库' })
  await expect(dialog.getByRole('button', { name: /新建 上传文档/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /关联已有 复用/ })).toBeVisible()
  await expect(dialog.locator('.knowledge-provider-grid > button')).toHaveCount(2)
  await expect(dialog.getByLabel('嵌入模型')).toHaveValue(JSON.stringify(['p1', 'm1']))
  await expect(dialog.getByLabel('嵌入模型').locator('option:checked')).toContainText('qwen3-embedding:0.6b · Local Ollama')
  await expect(dialog).toContainText('检索画像: hybrid')
  await expect(dialog).toContainText('每次查询结果数: 5')
  await expect(dialog).toContainText('分块大小: 512 / 分块重叠: 50')
  await expect(dialog.getByLabel('检索模式')).toBeVisible()
  await expect(dialog.getByLabel('创建时上传文件')).toBeAttached()
  await dialog.getByRole('button', { name: /关联已有 复用/ }).click()
  await dialog.getByLabel('知识库名称').fill('linked')
  await dialog.getByLabel('文件夹路径').fill('/tmp/existing-index')
  await dialog.getByRole('button', { name: '关联', exact: true }).click()
  await expect(page).toHaveURL(/knowledge-bases\/account%3Akb%3Alinked/)
})


test('knowledge creation submits the selected embedding and retrieval mode', async ({ page }) => {
  let createBody = ''
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [] }))
  await page.route('**/api/knowledge-bases/rag-providers?*', route => route.fulfill({ json: { providers: [{ id: 'llamaindex', name: 'LlamaIndex', description: 'Local vector retrieval', configured: true, modes: ['hybrid', 'vector'], default_mode: 'hybrid' }] } }))
  await page.route('**/api/knowledge-bases/rag-pipelines/model-options?*', route => route.fulfill({ json: { embedding: { active: { profile_id: 'p1', model_id: 'm1' }, options: [{ profile_id: 'p1', profile_name: 'Local Ollama', model_id: 'm1', label: 'qwen3-embedding:0.6b' }] } } }))
  await page.route('**/api/knowledge-bases/rag-pipelines/llamaindex/config?*', route => route.fulfill({ json: { retrieval_profile: 'hybrid', top_k: 5, chunk_size: 512, chunk_overlap: 50 } }))
  await page.route('**/api/knowledge-bases?*', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    createBody = route.request().postData() || ''
    return route.fulfill({ json: { name: 'account:kb:created', task_id: 't1', stage: 'completed' } })
  })
  await page.route('**/api/knowledge-bases/account%3Akb%3Acreated?*', route => route.fulfill({ json: { name: 'account:kb:created', status: 'ready', statistics: {} } }))
  await page.goto('/knowledge-bases')
  await page.getByRole('button', { name: '新建知识库', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '创建知识库' })
  await dialog.getByLabel('知识库名称').fill('created')
  await dialog.getByLabel('检索模式').selectOption('vector')
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect.poll(() => createBody).toContain('embedding_model')
  expect(createBody).toContain(JSON.stringify(['p1', 'm1']))
  expect(createBody).toContain('vector')
  expect(createBody).toContain('created')
})
