import { expect, test } from '@playwright/test'

const airtable = {
  id: 'airtable', display_name: 'Airtable', description_i18n: { zh: '读取并更新 Airtable 的 base、数据表与记录。' },
  category: 'business', tier: 'curated', transport: 'streamableHttp', trust: 'unverified', self_service: true,
  installed: false, installed_as: [], homepage: 'https://airtable.com', docs_url: 'https://airtable.com/developers',
  fields: [{ key: 'token', label_i18n: { zh: '个人访问令牌' }, secret: true, required: true, placeholder: 'pat…' }],
}

test('MCP store opens a real detail form and installs with credentials', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  let servers: Record<string, any> = {}
  await page.route('**/api/space/mcp/servers?*', route => route.fulfill({ json: { servers, status: {}, configured_secrets: {}, oauth: {}, rejected: [], deployment: { servers: [] }, limits: { max_servers: 8 } } }))
  await page.route(/\/api\/space\/mcp\/catalog\?(?!.*\/install).*$/, route => {
    expect(route.request().url()).toContain('limit=12')
    return route.fulfill({ json: { entries: [airtable], categories: { business: 1 }, next_cursor: '', total: 1 } })
  })
  await page.route('**/api/space/mcp/catalog/airtable/install*', async route => {
    expect(route.request().postDataJSON()).toEqual({ name: 'airtable', secrets: { token: 'secret-token' } })
    servers = { airtable: { url: 'https://airtable.example/mcp', type: 'streamableHttp', enabled: true } }
    await route.fulfill({ json: { servers, status: {}, configured_secrets: { airtable: ['token'] }, oauth: {}, rejected: [], deployment: { servers: [] }, limits: { max_servers: 8 } } })
  })
  await page.route('**/api/space/mcp/servers/airtable/test*', async route => {
    expect(route.request().postDataJSON().config.url).toBe('https://airtable.example/mcp')
    await route.fulfill({ json: { ok: true, tools: [{ name: 'list_records' }] } })
  })

  await page.goto('/space/mcp')
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await expect(page.locator('.mcp-store-grid')).toHaveCSS('grid-template-columns', /.+ .+/)
  await expect(page.locator('.mcp-filter-chips')).toContainText('业务')
  await expect(page.locator('.mcp-store-card')).not.toContainText('streamableHttp · curated')
  await expect(page.locator('.mcp-store-card')).toContainText('需要凭据')
  await page.getByRole('button', { name: '查看详情：Airtable' }).click()
  await expect(page.locator('.mcp-entry-detail')).toContainText('Airtable')
  await expect(page.getByRole('link', { name: '官方网站' })).toHaveAttribute('href', 'https://airtable.com')
  const install = page.locator('.mcp-install-actions .primary')
  await expect(install).toBeDisabled()
  await page.getByLabel('个人访问令牌').fill('secret-token')
  await expect(install).toBeEnabled()
  await install.click()
  await expect(page.locator('.mcp-probe.ok')).toContainText('连接成功，检测到 1 个工具')
  await expect(page.locator('.mcp-entry-detail')).toBeVisible()
  await expect(install).toContainText('重新安装')
  await page.getByRole('button', { name: '返回商店' }).click()
  await expect(page.locator('.mcp-store-card')).toContainText('已安装')
})
