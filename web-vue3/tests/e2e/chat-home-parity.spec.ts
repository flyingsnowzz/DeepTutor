import { expect, test, type Page } from '@playwright/test'

async function allowWithoutAuth(page: Page) {
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: true } }))
}

test('new chat uses the legacy centered composer, mode menus, preferences and partner selection', async ({ page }) => {
  await allowWithoutAuth(page)
  await page.addInitScript(() => {
    const messages: Record<string, unknown>[] = []
    ;(window as unknown as { __homeMessages: typeof messages }).__homeMessages = messages
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      send(raw: string) {
        const value = JSON.parse(raw) as Record<string, unknown>
        messages.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'session_meta', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3; this.onclose?.() }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
  })
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.route('**/api/capabilities/registered?*', route => route.fulfill({ json: [{ id: 'chat', available: true }, { id: 'ask_questions', available: true }] }))
  await page.route('**/api/settings/llm-options?*', route => route.fulfill({ json: { active: null, options: [{ profile_id: 'p1', model_id: 'm1', profile_name: 'Profile', model_name: 'Model One' }] } }))
  await page.route('**/api/personas?*', route => route.fulfill({ json: { personas: [{ id: 'tutor', name: 'Tutor' }] } }))
  await page.route('**/api/knowledge-bases/list?*', route => route.fulfill({ json: [{ id: 'kb1', name: 'Library' }] }))
  await page.route('**/api/skills/list?*', route => route.fulfill({ json: { skills: [{ id: 'skill1', name: 'Study skill' }] } }))
  await page.route('**/api/space/mcp/servers?*', route => route.fulfill({ json: { servers: { search: {} } } }))
  await page.route('**/api/notebooks?*', route => route.fulfill({ json: { notebooks: [{ id: 'n1', name: 'Favorites' }] } }))
  await page.route('**/api/partners?*', route => route.fulfill({ json: [{ partner_id: 'partner1', name: 'Research partner' }] }))
  await page.route('**/api/settings?*', route => route.fulfill({ json: { ui: {} } }))
  await page.goto('/chat')
  await expect(page.locator('.chat-shell')).toHaveClass(/is-new-conversation/)
  await expect(page.getByPlaceholder('今天我能帮您什么？')).toBeVisible()
  await expect(page.locator('.chat-location')).toContainText('聊天')
  await expect(page.locator('.chat-mode-bar')).toContainText('模式')
  await expect(page.locator('.composer-actions')).toContainText('资源')
  await expect(page.locator('.chat-mode-bar')).toContainText('伙伴')
  await expect(page.locator('.chat-mode-bar')).toContainText('偏好')
  await expect(page.getByLabel('笔记', { exact: true })).toHaveAttribute('title', '在聊天中写 Markdown')
  await expect(page.getByLabel('活动', { exact: true })).toHaveAttribute('title', '会话活动、附件与预览')
  await expect(page.getByLabel('自定义页面', { exact: true })).toHaveAttribute('aria-haspopup', 'dialog')

  await page.getByRole('button', { name: '资源', exact: true }).click()
  const resources = page.getByRole('dialog', { name: '资源' })
  await expect(resources).toContainText('收藏夹')
  await resources.getByRole('button', { name: /知识库/ }).click()
  await expect(resources).toContainText('Library')
  await resources.getByRole('button', { name: '关闭' }).click()
  await page.getByRole('button', { name: /技能/ }).click()
  const skills = page.getByRole('dialog', { name: '技能' })
  await skills.getByRole('option', { name: /Study skill/ }).click()
  await expect(page.getByRole('button', { name: /技能/ })).toContainText('已引用 1 个')
  await page.getByRole('button', { name: /技能/ }).click()
  await page.getByRole('button', { name: /连接器/ }).click()
  const connectors = page.getByRole('dialog', { name: '连接器' })
  await connectors.getByRole('option', { name: /search/ }).click()
  await expect(page.getByRole('button', { name: /连接器/ })).toContainText('已引用 1 个')
  await page.getByRole('button', { name: /连接器/ }).click()
  await page.getByRole('button', { name: '模式', exact: true }).click()
  await page.getByRole('menuitem', { name: /主动提问/ }).click()
  await expect(page.getByLabel('对话能力')).toHaveValue('ask_questions')

  await page.getByRole('button', { name: '选择模型', exact: true }).click()
  await page.getByRole('dialog', { name: '选择模型' }).getByRole('option').filter({ hasText: 'Model One' }).click()
  await page.getByRole('button', { name: /偏好/ }).click()
  const preferences = page.getByRole('dialog', { name: '偏好' })
  await preferences.getByRole('option', { name: /^Tutor 回答风格$/ }).click()
  await page.getByRole('button', { name: '伙伴', exact: true }).click()
  await page.getByRole('option', { name: /Research partner/ }).click()
  await page.getByPlaceholder('今天我能帮您什么？').fill('Explore with me')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __homeMessages: Record<string, unknown>[] }).__homeMessages.length)).toBeGreaterThan(0)
  const messages = await page.evaluate(() => (window as unknown as { __homeMessages: Record<string, unknown>[] }).__homeMessages)
  const start = messages.find(message => message.type === 'start_turn')
  expect(start?.capability).toBe('ask_questions')
  expect(start?.consult_partner_id).toBe('partner1')
  expect(start?.persona).toBe('Tutor')
  expect(start?.llm_selection).toEqual({ profile_id: 'p1', model_id: 'm1' })
  expect(start?.skills).toEqual(['skill1'])
  expect(start?.mcp).toEqual(['search'])
})

test('page customization edits modes, controls and starter prompts through the legacy dialog', async ({ page }) => {
  await allowWithoutAuth(page)
  const defaults = {
    chat: {
      hidden_modes: [],
      controls: { skills: true, mcp: true, partners: true, preferences: true, voice: true },
      starters: {},
    },
    learning: { hidden_features: [] },
  }
  let saved: typeof defaults | null = null
  await page.route('**/api/settings/page-customization?*', route => route.fulfill({ json: saved || defaults }))
  await page.route('**/api/settings/page-customization/chat?*', async route => {
    const chat = route.request().postDataJSON() as typeof defaults.chat
    saved = { chat, learning: { hidden_features: [] } }
    return route.fulfill({ json: saved })
  })
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [] } }))
  await page.route('**/api/capabilities/registered?*', route => route.fulfill({ json: [{ id: 'chat', available: true }, { id: 'ask_questions', available: true }] }))
  await page.goto('/chat')
  await page.getByRole('button', { name: '自定义页面' }).click()
  await expect(page.getByRole('dialog', { name: '自定义页面' })).toBeVisible()
  const customizeDialog = page.getByRole('dialog', { name: '自定义页面' })
  await expect(customizeDialog.getByRole('button', { name: '模式', exact: true })).toBeVisible()
  await expect(customizeDialog.getByRole('button', { name: '输入工具', exact: true })).toBeVisible()
  await expect(customizeDialog.getByRole('button', { name: '起始提示', exact: true })).toBeVisible()
  await page.getByRole('switch', { name: /主动提问/ }).click()
  await customizeDialog.getByRole('button', { name: '输入工具', exact: true }).click()
  await page.getByRole('switch', { name: '语音输入', exact: true }).click()
  await page.getByRole('switch', { name: '伙伴', exact: true }).click()
  await customizeDialog.getByRole('button', { name: '起始提示', exact: true }).click()
  await page.locator('.chat-customize-prompts article').first().locator('input').fill('Custom prompt')
  await page.locator('.chat-customize-prompts article').first().locator('textarea').fill('Custom prompt body')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(saved?.chat.hidden_modes).toEqual(['ask_questions'])
  expect(saved?.chat.controls.voice).toBe(false)
  expect(saved?.chat.controls.partners).toBe(false)
  await expect(page.getByRole('button', { name: '录制语音' })).toHaveCount(0)
  await expect(page.locator('.chat-mode-partner')).toHaveCount(0)
  await page.getByRole('button', { name: '模式', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /主动提问/ })).toHaveCount(0)
  await page.getByRole('button', { name: '模式', exact: true }).click()
  await page.getByRole('button', { name: '讲解', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Custom prompt' })).toBeVisible()
  await page.getByRole('button', { name: 'Custom prompt' }).click()
  await expect(page.getByPlaceholder('今天我能帮您什么？')).toHaveValue('Custom prompt body')
})
