import { expect, test } from '@playwright/test'

test('L3 opens recent summary, exposes only legacy slots and labels the breadcrumb', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route(/\/api\/memory\/overview(?:\?.*)?$/, route => route.fulfill({ json: {
    docs: [
      { layer: 'L3', key: 'recent', exists: false, updated_at: null, entry_count: 0, backlog: 0 },
      { layer: 'L3', key: 'profile', exists: false, updated_at: null, entry_count: 0, backlog: 0 },
      { layer: 'L3', key: 'scope', exists: false, updated_at: null, entry_count: 0, backlog: 0 },
      { layer: 'L3', key: 'preferences', exists: true, updated_at: null, entry_count: 7, backlog: 0 },
    ],
  } }))
  await page.route(/\/api\/memory\/doc\/L3\/recent\/lines(?:\?.*)?$/, route => route.fulfill({ json: { lines: [] } }))
  await page.route(/\/api\/memory\/doc\/L3\/recent(?!\/lines)(?:\?.*)?$/, route => route.fulfill({ json: { content: '' } }))
  await page.route(/\/api\/memory\/snapshot\/[^/?]+(?:\?.*)?$/, route => route.fulfill({ json: { entities: [], pending_changes: [] } }))
  await page.route(/\/api\/settings\/llm-options(?:\?.*)?$/, route => route.fulfill({ json: { active: null, options: [] } }))
  await page.route(/\/api\/memory\/settings(?:\?.*)?$/, route => route.fulfill({ json: { update: { l2_budget: 20, l3_budget: 12 }, audit: { l2_budget: 10, l3_budget: 8 }, dedup: { iterations: 3, auto_after_update: false } } }))

  await page.goto('/memory/l3')
  await expect(page.locator('.memory-breadcrumb')).toContainText('L3 · 跨模块知识')
  await expect(page.locator('.memory-breadcrumb')).toContainText('近期总结')
  await expect(page.locator('.memory-rail>a')).toHaveCount(3)
  await expect(page.locator('.memory-rail')).toContainText('近期总结')
  await expect(page.locator('.memory-rail')).toContainText('用户画像')
  await expect(page.locator('.memory-rail')).toContainText('知识 Scope')
  await expect(page.locator('.memory-rail')).not.toContainText('偏好')
  await expect(page.locator('.memory-rail>a.active')).toContainText('近期总结')
  await expect(page.locator('.memory-run-panel')).toBeVisible()

  await page.goto('/memory/l3/profile')
  await expect(page.locator('.memory-breadcrumb')).toContainText('用户画像')
  await expect(page.locator('.memory-rail>a.active')).toContainText('用户画像')
})
