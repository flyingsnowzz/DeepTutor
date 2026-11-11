import { expect, test } from '@playwright/test'

const entry = 'm_00000000000000000000000000'

test('memory graph keeps full-canvas controls and a floating node preview', async ({ page }) => {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/memory/snapshot/*', route => {
    const surface = new URL(route.request().url()).pathname.split('/').at(-1)
    return route.fulfill({ json: { entities: surface === 'chat' ? [{ id: 'e1', label: 'Conversation', ts: '', content: 'Raw' }] : [] } })
  })
  await page.route('**/api/memory/doc/L2/*', route => {
    const surface = new URL(route.request().url()).pathname.split('/').at(-1)
    return route.fulfill({ json: { content: surface === 'chat' ? `# Chat\n\n- Summary [^1] <!--${entry}-->\n\n[^1]: chat:e1` : '' } })
  })
  await page.route('**/api/memory/doc/L3/*', route => {
    const slot = new URL(route.request().url()).pathname.split('/').at(-1)
    return route.fulfill({ json: { content: slot === 'profile' ? `# Profile\n\n- Preference [^1] <!--${entry}-->\n\n[^1]: chat:${entry}` : '' } })
  })
  await page.goto('/memory/graph')
  await expect(page.locator('.memory-node')).toHaveCount(3)
  await expect(page.locator('svg path[fill="url(#halo-l3)"]')).toHaveCount(3)
  await expect(page.locator('svg path[fill="url(#halo-l2)"]')).toHaveCount(7)
  await expect(page.locator('svg path[fill="url(#halo-l1)"]')).toHaveCount(7)
  await expect(page.locator('.memory-graph-detail')).toHaveCount(0)
  await expect(page.locator('.memory-graph-canvas')).toHaveCSS('position', 'absolute')
  await expect(page.locator('.memory-graph-controls')).toBeVisible()
  await expect(page.locator('.memory-graph-controls svg')).toHaveCount(6)
  await expect(page.locator('.memory-graph-canvas')).toHaveCSS('background-image', /radial-gradient/)
  await expect(page.locator('.memory-graph-zoom')).toContainText('62%')
  await expect(page.locator('.memory-graph-legend > div > span')).toHaveText(['L3 1', 'L2 1', 'L1 1'])
  await expect(page.locator('.memory-graph-canvas .memory-cluster-label').filter({ hasText: '聊天' }).first()).toBeVisible()
  await expect(page.locator('.memory-graph-canvas .memory-cluster-count').filter({ hasText: '1 条事件' }).first()).toBeVisible()
  await expect(page.locator('.memory-l3-center')).toHaveCount(1)
  await page.locator(`[data-node="L2:chat:${entry}"]`).click()
  await expect(page.locator('.memory-graph-hovercard')).toContainText('Summary')
})
