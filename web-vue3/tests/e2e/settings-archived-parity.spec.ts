import { expect, test } from '@playwright/test'

test('archived settings loads every page, groups conversations, and restores in their workspace', async ({ page }) => {
  const sessions = Array.from({ length: 200 }, (_, index) => ({ session_id: `live-${index}`, title: `Live ${index}`, updated_at: 1, preferences: { archived: false } }))
  sessions.push({ session_id: 'old-chat', title: 'Old chat', updated_at: 2, preferences: { archived: true, workspace_id: 'research' } })
  const patches: Array<{ url: string; body: unknown }> = []
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: false } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/sessions?*', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0)
    return route.fulfill({ json: { sessions: sessions.slice(offset, offset + 200) } })
  })
  await page.route('**/api/sessions/old-chat/organization?*', async route => {
    patches.push({ url: route.request().url(), body: route.request().postDataJSON() })
    sessions[200].preferences.archived = false
    await route.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/mastery-paths/topics/index*', route => route.fulfill({ json: { topics: [] } }))
  await page.route('**/api/reading/workspaces/index*', route => route.fulfill({ json: { collections: [] } }))
  await page.goto('/settings/archive')
  await expect(page.getByText('Old chat')).toBeVisible()
  await expect(page.locator('.archived-group h2')).toContainText(['对话 1'])
  await page.getByRole('button', { name: '取消归档' }).click()
  await expect.poll(() => patches.length).toBe(1)
  expect(patches[0].url).toContain('dt_workspace=research')
  expect(patches[0].body).toEqual({ archived: false })
})
