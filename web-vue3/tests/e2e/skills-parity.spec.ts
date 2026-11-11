import { expect, test } from '@playwright/test'

test('skill library restores scope selection, tag management and full cards', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/settings/workspace/registrations?*', route => route.fulfill({ json: { workspaces: [{ workspace_id: 'class', kind: 'workspace', display_name: 'Class', archived: false }] } }))
  await page.route('**/api/skills/list?*', route => route.fulfill({ json: { skills: [
    { name: 'docx', description: 'Word documents', source: 'builtin', read_only: true, tags: ['tool', 'office'] },
    { name: 'skill-creator', description: 'Author skills', source: 'builtin', read_only: true, tags: [] },
  ] } }))
  let tagNames = ['tool', 'style']
  await page.route('**/api/skills/tags/list?*', route => route.fulfill({ json: { tags: tagNames } }))
  await page.route('**/api/skills/tags/tool?*', route => {
    if (route.request().method() === 'PUT') {
      tagNames = ['workspace', 'style']
      return route.fulfill({ json: { name: 'workspace' } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/space/skills')
  await expect(page.locator('.skill-page-bar')).toContainText('2 个技能')
  await expect(page.getByRole('searchbox', { name: '搜索技能' })).toHaveCount(0)
  await expect(page.locator('.skill-scope-panel')).toContainText('账户共享技能')
  await expect(page.locator('.resource-tags>summary')).toContainText('管理标签 2')
  await expect(page.locator('.resource-tag-filters')).toContainText('全部 2')
  await expect(page.locator('.resource-tag-filters')).toContainText('tool 1')
  await expect(page.locator('.resource-tag-filters')).toContainText('未分类 1')
  await expect(page.locator('.resource-item-card').nth(1)).toContainText('内置')
  await expect(page.locator('.resource-item-card').first().locator('.resource-source-badge')).toHaveText('内置')
  await expect(page.locator('.resource-item-card').first().locator('.channel-tag').first()).toHaveText('tool')
  await expect(page.locator('.resource-item-heading p').first()).toHaveCSS('-webkit-line-clamp', '2')
  await page.locator('.resource-tags>summary').click()
  await page.getByRole('button', { name: '重命名', exact: true }).first().click()
  await page.getByRole('textbox', { name: '重命名标签' }).fill('workspace')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.resource-tags')).toContainText('workspace')
  await page.getByLabel('技能库', { exact: true }).selectOption('class')
  await expect(page).toHaveURL(/skill_workspace=class/)
})
