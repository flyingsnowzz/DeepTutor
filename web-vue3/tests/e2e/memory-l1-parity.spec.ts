import { expect, test } from '@playwright/test'

test('L1 memory defaults to notebook and provides snapshot and changes views', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route(/\/api\/memory\/overview(?:\?.*)?$/, route => route.fulfill({ json: { docs: [] } }))
  await page.route(/\/api\/memory\/snapshot\/([^/?]+)(?:\?.*)?$/, route => {
    const surface = route.request().url().match(/snapshot\/([^/?]+)/)?.[1]
    return route.fulfill({ json: { entities: surface === 'notebook' ? [{ id: 'n1', label: 'Saved item', content: 'Content', ts: 'now' }] : [], pending_changes: [] } })
  })
  await page.route(/\/api\/memory\/snapshot\/notebook\/changes(?:\?.*)?$/, route => route.fulfill({ json: { changes: [{ ts: 'now', kind: 'added', entity_id: 'n1', label: 'Saved item' }] } }))
  await page.goto('/memory/l1')
  await expect(page.locator('.memory-page-bar')).toBeVisible()
  await expect(page.locator('.memory-rail>a.active')).toContainText('收藏夹')
  await expect(page.locator('.memory-entity-count')).toContainText('1 条实体')
  await expect(page.locator('.memory-entity-card')).toContainText('Saved item')
  await expect(page.locator('.memory-layer-switch>a')).toHaveCount(3)
  await expect(page.locator('.memory-run-panel')).toHaveCount(0)
  await expect(page.locator('.memory-workbench')).not.toHaveClass(/with-run-panel/)
  await page.locator('.memory-l1-mode').getByRole('button', { name: '变更' }).click()
  await expect(page.locator('.memory-change-row')).toContainText('Saved item')
})
