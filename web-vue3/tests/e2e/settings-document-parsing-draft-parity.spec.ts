import { expect, test } from '@playwright/test'

test('document parsing draft does not overwrite the separate MinerU draft', async ({ page }) => {
  let parsingBody: any = null
  let mineruBody: any = null
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'zh', theme: 'snow' } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: route.request().method() === 'GET' ? { draft: { extensions: { knowledge: { engine: 'mineru', image_description_model: null, engines: { mineru: { mode: 'stale' }, text_only: { enabled: true } } }, mineru: { mode: 'remote' } } } } : {} }))
  await page.route('**/api/settings/document-parsing?*', route => { parsingBody = route.request().postDataJSON(); return route.fulfill({ json: {} }) })
  await page.route('**/api/settings/mineru?*', route => { mineruBody = route.request().postDataJSON(); return route.fulfill({ json: {} }) })
  await page.goto('/settings/general')
  await page.getByRole('button', { name: '应用更改' }).click()
  await expect.poll(() => parsingBody).toEqual({ engine: 'mineru', image_description_model: null, engines: { text_only: { enabled: true } } })
  await expect.poll(() => mineruBody).toEqual({ mode: 'remote' })
})
