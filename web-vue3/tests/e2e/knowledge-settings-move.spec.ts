import { expect, test } from '@playwright/test'

test('knowledge settings reviews and commits a workspace move like the legacy flow', async ({ page }) => {
  const kb = { id: 'account:kb:demo', name: 'account:kb:demo', status: 'ready', metadata: { rag_provider: 'llamaindex' }, statistics: {} }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [kb] }))
  await page.route('**/api/knowledge-bases/account%3Akb%3Ademo?*', route => route.fulfill({ json: kb }))
  await page.route('**/api/knowledge-bases/account%3Akb%3Ademo/files?*', route => route.fulfill({ json: { files: [] } }))
  await page.route('**/api/knowledge-bases/account%3Akb%3Ademo/progress?*', route => route.fulfill({ json: { stage: 'completed', percent: 100 } }))
  await page.route('**/api/settings/workspace/registrations?*', route => route.fulfill({ json: { workspaces: [
    { workspace_id: 'general', kind: 'system', display_name: 'General', archived: false, status: 'ready' },
    { workspace_id: 'physics', kind: 'workspace', display_name: 'Physics', archived: false, status: 'ready' },
  ] } }))
  await page.route('**/api/settings/workspace/knowledge-bases/preview-move?*', route => route.fulfill({ json: { source_id: 'account:kb:demo', target_id: 'workspace:physics:kb:demo', files: 3, bytes: 2048, assignments: [{ workspace_id: 'class', display_name: 'Classroom' }], blockers: [] } }))
  await page.route('**/api/settings/workspace/knowledge-bases/move?*', route => route.fulfill({ json: { target_id: 'workspace:physics:kb:demo', files: 3, bytes: 2048, assignments: [], blockers: [] } }))
  await page.goto('/knowledge-bases/account%3Akb%3Ademo')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.kb-move-action')).toBeVisible()
  await page.getByLabel('目标工作区').selectOption('physics')
  await page.getByRole('button', { name: '检查移动详情', exact: true }).click()
  await expect(page.locator('.kb-move-preview')).toContainText('3 个文件 · 2.0 KB')
  await expect(page.locator('.kb-move-preview')).toContainText('Classroom')
  await page.locator('.kb-move-preview').getByRole('button', { name: /移动知识库/ }).click()
  await expect(page).toHaveURL(/knowledge-bases\/workspace%3Aphysics%3Akb%3Ademo/)
})
