import { expect, test } from '@playwright/test'

test('development backend outage shows one actionable notice instead of raw connection errors', async ({ page }) => {
  await page.route('**/api/**', route => route.abort('connectionrefused'))
  await page.goto('/settings/general')
  const notice = page.getByRole('alert').filter({ hasText: '开发后端未连接' })
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('请确认后端已启动')
  await expect(page.getByText(/ConnectionRefusedError|Errno 61|ECONNREFUSED/)).toHaveCount(0)
})
