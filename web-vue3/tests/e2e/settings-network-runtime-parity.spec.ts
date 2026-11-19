import { expect, test } from '@playwright/test'

test('network settings shows runtime health and read-only turn coordination', async ({ page }) => {
  let refreshes = 0
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/network*', route => route.fulfill({ json: { settings: { backend_port: 8001, frontend_port: 3783, public_api_base: '', cors_origins: [] }, effective: { browser_api_base: 'http://localhost:8001', cors_mode: 'permissive' }, auth: { enabled: true, cookie_secure: true, cookie_samesite: 'Lax', cross_site_cookie_ready: true }, restart_required: true } }))
  await page.route('**/api/system/runtime*', route => {
    refreshes++
    return route.fulfill({ json: { runtime_status: { worker_id: 'worker-1', worker_count: 2, coordination_mode: 'redis', redis_configured: true, redis_status: 'ok', leader_id: 'worker-1', leader_healthy: true, owner_turn_count: 3, recovery_backlog: 0, lease_ttl_seconds: 30, renew_interval_seconds: 10, recovery_interval_seconds: 5, protocol_version: '2.0' } } })
  })
  await page.goto('/settings/network')
  await expect(page.getByRole('heading', { name: /轮次运行状态/ })).toBeVisible()
  await expect(page.getByText('正常', { exact: true })).toBeVisible()
  await expect(page.getByText('worker-1', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '轮次协调' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '后端工作进程' })).toBeDisabled()
  await page.getByText('高级', { exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '租约有效期（秒）' })).toHaveValue('30')
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect.poll(() => refreshes).toBe(2)
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => refreshes).toBe(3)
})
