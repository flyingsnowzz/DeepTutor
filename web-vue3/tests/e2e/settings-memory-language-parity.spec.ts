import { expect, test } from '@playwright/test'

test('memory settings follows applied language and stages loaded values', async ({ page }) => {
  const memory = {
    update: { l2_budget: 6, l3_budget: 7 }, audit: { l2_budget: 4, l3_budget: 5 },
    dedup: { iterations: 3, auto_after_update: false },
    merge: { auto_after_update: false, auto_after_audit: true, auto_after_dedup: false },
    chunking: { overlap_ratio: 0.1, boundary: 'paragraph', min_chunk_chars: 1200, max_chunk_chars: 4000 },
    reference: { enforce_required: true, drop_invalid_refs: true },
  }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog: { connections: [], services: {} } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/memory/settings*', route => route.fulfill({ json: memory }))
  await page.goto('/settings/memory')
  await expect(page.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Chunking' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'L2 budget (per surface)' }).first()).toHaveValue('6')
  await page.getByRole('spinbutton', { name: 'Iterations' }).fill('5')
  await expect(page.getByRole('spinbutton', { name: 'Iterations' })).toHaveValue('5')
})
