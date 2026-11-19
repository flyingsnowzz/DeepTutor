import { expect, test } from '@playwright/test'

test('usage statistics hides a previous year and ignores its late response', async ({ page }) => {
  const currentYear = new Date().getFullYear()
  let releaseOld: (() => void) | undefined
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: false } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/settings/usage?*', async route => {
    const requestedYear = Number(new URL(route.request().url()).searchParams.get('year'))
    if (requestedYear === currentYear - 1) await new Promise<void>(resolve => { releaseOld = resolve })
    await route.fulfill({ json: {
      year: requestedYear, totals: { total_tokens: requestedYear === currentYear ? 222 : 111, prompt_tokens: 0, completion_tokens: 0, cache_hit_rate: 0, total_calls: 1 },
      models: [], days: [], active_days: 0, turns: 1, tracked_turns: 1, sessions: 1,
    } })
  })
  await page.goto(`/settings/usage?year=${currentYear - 1}`)
  await expect(page.getByText('正在加载用量…')).toBeVisible()
  await page.getByRole('button', { name: '下一年' }).click()
  await expect(page.getByText('222', { exact: true })).toBeVisible()
  releaseOld?.()
  await expect(page.getByText('222', { exact: true })).toBeVisible()
  await expect(page.getByText('111', { exact: true })).toHaveCount(0)
})
