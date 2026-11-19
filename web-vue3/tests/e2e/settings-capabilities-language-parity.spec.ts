import { expect, test } from '@playwright/test'

test('capability settings follows English language and loads editable values', async ({ page }) => {
  const capabilities = {
    chat: { temperature: 0.7, max_rounds: 12, stage_budgets: { exploring: 4000, responding: 4000 } },
    solve: { temperature: 0.7, max_tokens: 4000, max_rounds: 12, max_replans: 2 },
    research: { temperature: 0.7, max_tokens: 4000, researching: { note_agent_mode: 'auto', tool_timeout: 60, tool_max_retries: 2, paper_search_years_limit: 5 } },
    question: { temperature: 0.7, max_tokens: 4000, exploring: { max_iterations: 6, tool_summarizer: { enabled: true, max_tokens: 1200 } } },
    co_writer: { temperature: 0.7, max_tokens: 4000 }, vision_solver: { temperature: 0.7, max_tokens: 4000 },
    math_animator: { temperature: 0.7, max_tokens: 4000 }, visualize: { temperature: 0.7, max_tokens: 4000 },
  }
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: true, authenticated: true, is_admin: true } }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: { language: 'en' }, catalog: { connections: [], services: {} } } }))
  await page.route('**/api/settings/draft?*', route => route.fulfill({ json: { draft: null } }))
  await page.route('**/api/capabilities/settings*', route => route.fulfill({ json: capabilities }))
  await page.goto('/settings/capabilities')
  await expect(page.getByRole('heading', { name: 'Capabilities', exact: true })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Exploring (max tokens)' })).toHaveValue('4000')
  await page.getByRole('spinbutton', { name: 'Exploring (max tokens)' }).fill('5000')
  await expect(page.getByRole('spinbutton', { name: 'Exploring (max tokens)' })).toHaveValue('5000')
})
