import { expect, test } from '@playwright/test'

test('CLI store uses legacy trust marks, brand icons and full-height cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/space/cli-apps/apps?*', route => route.fulfill({ json: { apps: [], access: { exec_denied: false } } }))
  await page.route('**/api/space/cli-apps/catalog?*', route => route.fulfill({ json: {
    entries: [
      { id: '3mf', display_name: '3MF', description: 'Mesh geometry editor for 3D printing files — detect and resize cylindrical holes, repair meshes, compare 3MF files', category: 'graphics', trust: 'first-party', installed: false, installable: true, pinned: true },
      { id: 'arcgis-pro', display_name: 'ArcGIS Pro', description: 'Agent-native CLI for ArcGIS Pro with professional cartography and geoprocessing support', category: 'scientific', trust: 'third-party', installed: false, installable: true, pinned: true },
    ],
    categories: { graphics: 7, scientific: 2 }, next_cursor: '', total: 2,
  } }))
  await page.goto('/space/cli-apps')
  await page.getByRole('button', { name: '商店', exact: true }).click()
  const cards = page.locator('.cli-catalog-grid>li')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('3M')
  await expect(cards.first()).toContainText('已固定版本')
  await expect(cards.first().locator('.cli-chip.pinned')).toHaveCSS('color', 'rgb(4, 120, 87)')
  await expect(cards.nth(1)).toContainText('第三方')
  await expect(cards.nth(1).locator('.cli-brand-icon svg')).toBeVisible()
  await expect(cards.first()).toHaveCSS('height', '133.75px')
  await expect(cards.first()).toHaveCSS('width', '542px')
  await page.getByRole('button', { name: '查看详情：3MF' }).click()
  await expect(page.locator('.cli-entry-detail')).toContainText('cli_3mf')
  await expect(page.locator('.cli-entry-detail')).toContainText('只有管理员可以安装')
  await expect(page.locator('.cli-install-panel')).toHaveCount(0)
  await page.getByRole('button', { name: '返回商店' }).click()
  await expect(page.locator('.cli-catalog-grid')).toBeVisible()
})
