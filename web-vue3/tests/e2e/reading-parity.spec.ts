import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

test('reading library uses the legacy empty card and collection dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await allowWithoutAuth(page)
  await page.route('**/api/reading/workspaces?*', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { workspace: { workspace_id: 'w1', title: 'Paper review', description: '', color: 'blue', tabs: [] } } })
    return route.fulfill({ json: { workspaces: [] } })
  })
  await page.route('**/api/reading/library/materials?*', route => route.fulfill({ json: { materials: [] } }))
  await page.route('**/api/reading/workspaces/w1?*', route => route.fulfill({ json: { workspace: { workspace_id: 'w1', title: 'Paper review', description: '', color: 'blue', active_material_id: null, tabs: [] }, sessions: [] } }))
  await page.goto('/learning/reading')
  await expect(page.locator('.reading-page-bar')).toContainText('沉浸式阅读')
  await expect(page.locator('.reading-page-bar h1 svg')).toBeVisible()
  const newFolder = page.getByRole('button', { name: '新建资料组' }).first()
  await expect(newFolder).toHaveCSS('height', '30px')
  await expect(newFolder).toHaveCSS('border-radius', '6px')
  await expect(page.locator('.reading-empty')).toContainText('还没有资料组')
  await expect(page.locator('.reading-empty')).toHaveCSS('border-style', 'dashed')
  await expect(page.locator('.reading-empty').boundingBox()).resolves.toMatchObject({ x: 308, width: 1096, height: 230 })
  await page.getByRole('button', { name: '新建资料组' }).first().click()
  await expect(page.getByRole('dialog', { name: '新建资料组' })).toBeVisible()
  await page.getByLabel('资料组名称').fill('Paper review')
  await page.getByRole('button', { name: '蓝色', exact: true }).click()
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page).toHaveURL(/\/learning\/reading\/folders\/w1$/)
})

test('material upload supports duplicate decisions and file upload', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.route('**/api/reading/workspaces?*', route => route.fulfill({ json: { workspaces: [] } }))
  await page.route('**/api/reading/library/materials?*', route => route.fulfill({ json: { materials: [] } }))
  await page.route('**/api/reading/library/duplicate-check?*', route => route.fulfill({ json: { matches: [{ query: { filename: 'paper.pdf' }, kind: 'same_name', material: { material_id: 'old1', title: 'Existing paper', filename: 'paper.pdf', source_kind: 'file' } }] } }))
  await page.route('**/api/reading/materials?*', async route => {
    expect(route.request().postDataBuffer()?.toString()).toMatch(/name="reuse"[\s\S]*false/)
    return route.fulfill({ json: { material_id: 'new1' } })
  })
  await page.goto('/learning/reading/materials')
  await page.getByRole('button', { name: '导入资料' }).click()
  await expect(page.getByRole('dialog', { name: '上传资料' })).toBeVisible()
  await page.locator('.add-materials-dialog input[type="file"]').setInputFiles({ name: 'paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from('new pdf content') })
  await expect(page.locator('.add-materials-duplicate')).toContainText('发现同名资料')
  await page.getByRole('button', { name: '作为新资料' }).click()
  await page.getByRole('button', { name: '上传资料', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.notice')).toContainText('资料已添加')
})
