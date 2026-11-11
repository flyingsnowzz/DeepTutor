import { expect, test } from '@playwright/test'

test('group detail restores the legacy side panel and manage dialog', async ({ page }) => {
  const group: Record<string, unknown> = {
    group_id: 'g1', owner_id: 'u', name: 'Study Council', description: 'Two tutors reviewing one plan',
    discussion_mode: 'panel_parallel', emoji: '📚', color: '#b0501e', shared_memory: 'whiteboard',
    member_ids: ['p1', 'p2'], created_at: '2026-01-01', updated_at: '2026-01-01', version: 1,
    members: [
      { partner_id: 'p1', name: 'Ada', emoji: '🦊', color: '#b0501e', running: true, description: 'Math tutor' },
      { partner_id: 'p2', name: 'Bash', emoji: '🐳', color: '#3d6b8a', running: true, description: 'Language tutor' },
    ],
  }
  let savedMode = ''
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = (body: unknown) => route.fulfill({ json: body })
    if (path === '/api/auth/status') return json({ enabled: false, authenticated: false, is_admin: false })
    if (path === '/api/partners') return json(group.members)
    if (path === '/api/partner-groups') return json([group])
    if (path === '/api/partner-groups/discussion-modes') return json([{ name: 'panel_parallel', label: '', description: '' }, { name: 'sequential', label: '', description: '' }, { name: 'debate', label: '', description: '' }])
    if (path === '/api/partner-groups/g1') {
      if (route.request().method() === 'PATCH') { savedMode = route.request().postDataJSON().discussion_mode; Object.assign(group, route.request().postDataJSON()) }
      return json(group)
    }
    if (path === '/api/partner-groups/g1/sessions') return json([{ session_key: 's1', title: 'Weekly plan', last_message: 'Next', updated_at: 1770000000 }])
    if (path === '/api/partner-groups/g1/sessions/s1/history') return json([])
    if (path === '/api/partner-groups/g1/whiteboard') return json([{ entry_id: 'w1', author_name: 'Ada', content: 'Shared note' }])
    if (path === '/api/settings/workspace/registrations') return json({ workspaces: [] })
    if (path === '/api/settings/ui') return json({ language: 'zh', response_language: 'zh', theme: 'snow' })
    return json({})
  })
  await page.goto('/partners/groups/g1')
  await page.getByRole('button', { name: '详情' }).click()
  const panel = page.locator('.group-side-panel')
  await expect(panel).toHaveCSS('width', '360px')
  await page.getByRole('button', { name: '共享上下文' }).click()
  await expect(panel).toContainText('群组内所有伙伴可见')
  await expect(panel).toContainText('Shared note')

  await page.getByRole('button', { name: '管理' }).click()
  const dialog = page.getByRole('dialog', { name: '管理伙伴群组' })
  await expect(dialog).toHaveCSS('width', '512px')
  await expect(dialog.locator('.group-manage-modes>button')).toHaveCount(3)
  await expect(dialog.locator('.group-manage-modes>button').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.locator('.group-manage-modes>button').nth(1)).toContainText('较慢 · 需要依次等待')
  await expect(dialog.locator('.group-manage-members>button.active')).toHaveCount(2)
  await dialog.locator('.group-manage-modes>button').nth(1).click()
  await expect(dialog.locator('.group-manage-modes>button').nth(1)).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => savedMode).toBe('sequential')
})
