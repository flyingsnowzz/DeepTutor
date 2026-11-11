import { expect, test } from '@playwright/test'

test('L2 memory run panel starts a task, streams traces and resets the document', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route(/\/api\/memory\/overview(?:\?.*)?$/, route => route.fulfill({ json: { docs: [{ layer: 'L2', key: 'chat', exists: false, updated_at: null, entry_count: 0, backlog: 0 }] } }))
  await page.route(/\/api\/memory\/doc\/L2\/chat\/lines(?:\?.*)?$/, route => route.fulfill({ json: { lines: [] } }))
  await page.route(/\/api\/memory\/doc\/L2\/chat(?!\/lines)(?:\?.*)?$/, route => route.fulfill({ json: { content: '' } }))
  await page.route(/\/api\/memory\/snapshot\/[^/?]+(?:\?.*)?$/, route => route.fulfill({ json: { entities: [], pending_changes: [] } }))
  await page.route(/\/api\/settings\/llm-options(?:\?.*)?$/, route => route.fulfill({ json: { active: null, options: [] } }))
  await page.route(/\/api\/memory\/settings(?:\?.*)?$/, route => route.fulfill({ json: { update: { l2_budget: 20, l3_budget: 12 }, audit: { l2_budget: 10, l3_budget: 8 }, dedup: { iterations: 3, auto_after_update: false } } }))
  await page.route(/\/api\/memory\/runs\/start(?:\?.*)?$/, async route => {
    expect(route.request().postDataJSON()).toEqual({ layer: 'L2', key: 'chat', mode: 'update', budget: 20, iterations: null, llm_selection: null, language: 'zh' })
    await route.fulfill({ json: { id: 'run1', run_id: 'run1', status: 'running' } })
  })
  await page.route(/\/api\/memory\/runs\/run1(?!\/events)(?:\?.*)?$/, route => route.fulfill({ json: { id: 'run1', run_id: 'run1', status: 'completed' } }))
  await page.route(/\/api\/memory\/runs\/run1\/events(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/event-stream',
    body: 'data: {"seq":1,"ts":"now","payload":{"stage":"run_started","mode":"update"}}\n\ndata: {"seq":2,"ts":"now","payload":{"stage":"llm_turn","system_prompt":"System","user_prompt":"Question","response":"Answer"}}\n\n',
  }))
  await page.route(/\/api\/memory\/doc\/L2\/chat\/reset(?:\?.*)?$/, route => route.fulfill({ json: {} }))
  await page.goto('/memory/l2/chat')
  const panel = page.locator('.memory-run-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.memory-run-empty')).toContainText('选择一个模式并点击「运行」')
  await expect(panel.getByLabel('预算')).toHaveValue('20')
  await panel.getByRole('button', { name: '运行', exact: true }).click()
  await expect(panel.locator('.memory-run-event').first()).toContainText('开始运行')
  await expect(panel.locator('.memory-run-event').nth(1)).toContainText('Answer')
  page.once('dialog', dialog => dialog.accept())
  await panel.locator('.memory-run-reset').click()
  await expect(page.locator('.notice')).toContainText('记忆已重置')
})
