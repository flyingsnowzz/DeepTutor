import { expect, test } from '@playwright/test'

test('partners and skills stay within narrow viewports and resource dialog fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false } }))
  await page.route('**/api/partners?*', route => route.fulfill({ json: [
    { partner_id: 'p1', name: 'Partner with a very long display name', description: 'Description', can_manage: true, channels: [] },
  ] }))
  await page.route('**/api/partner-groups?*', route => route.fulfill({ json: [
    { group_id: 'g1', name: 'Group with a long name', member_ids: ['p1'], members: [{ partner_id: 'p1', name: 'Partner' }], discussion_mode: 'panel_parallel' },
  ] }))
  await page.route('**/api/skills/list?*', route => route.fulfill({ json: { skills: [
    { name: 'research-helper', description: 'Long description', tags: ['research'], content: '# Skill', read_only: false, source: 'user' },
  ] } }))
  await page.route('**/api/skills/tags/list?*', route => route.fulfill({ json: { tags: ['research'] } }))
  await page.route('**/api/skills/research-helper?*', route => route.fulfill({ json: { name: 'research-helper', description: 'Long description', tags: ['research'], content: '# Skill' } }))
  await page.route('**/api/settings/workspace/registrations?*', route => route.fulfill({ json: { workspaces: [] } }))

  await page.goto('/partners')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(page.locator('.partner-card').first()).toBeVisible()

  await page.goto('/space/skills')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '查看', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'research-helper' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeLessThanOrEqual(390)
})
