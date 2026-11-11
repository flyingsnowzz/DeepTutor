import { expect, test } from '@playwright/test'

test('chat messages copy, navigate turns, switch persisted branches and confirm turn deletion', async ({ page }) => {
  const session: { id: string; title: string; preferences: { selected_branches: Record<string, number> }; messages: Array<Record<string, unknown>> } = {
    id: 's1', title: 'Branches', preferences: { selected_branches: { '2': 3 } }, messages: [
      { id: 1, role: 'user', content: 'First question', parent_message_id: null },
      { id: 2, role: 'assistant', content: 'First answer', parent_message_id: 1, events: [{ type: 'done', metadata: { usage_summary: { total_tokens: 1000, prompt_tokens: 900, completion_tokens: 100, cache_input_tokens: 1000, cache_read_input_tokens: 100, cache_reported_calls: 1, cache_hit_rate: 0.1 } } }] },
      { id: 3, role: 'user', content: 'Original follow-up', parent_message_id: 2 },
      { id: 4, role: 'assistant', content: 'Original answer', parent_message_id: 3 },
      { id: 5, role: 'user', content: 'Third question', parent_message_id: 4 },
      { id: 6, role: 'assistant', content: 'Third answer', parent_message_id: 5 },
      { id: 7, role: 'user', content: 'Edited follow-up', parent_message_id: 2 },
      { id: 8, role: 'assistant', content: 'Edited answer', parent_message_id: 7, events: [{ type: 'done', metadata: { usage_summary: { total_tokens: 140, prompt_tokens: 100, completion_tokens: 40, cache_input_tokens: 100, cache_read_input_tokens: 80, cache_reported_calls: 1, cache_hit_rate: 0.8, ttft_seconds: 2, ttft_calls: 1, generation_seconds: 2, timed_completion_tokens: 40, tokens_per_second: 20 } } }, { type: 'result', metadata: { metadata: { context_budget: { window: 1000, used_tokens: 640, free_tokens: 360, model: 'test-model', counter: 'heuristic', window_estimated: true, deferred_tool_count: 2, segments: [{ key: 'messages', tokens: 400 }, { key: 'system_prompt', tokens: 240 }] } } } }] },
    ],
  }
  const selections: unknown[] = []
  const deletions: string[] = []
  const ttsBodies: unknown[] = []
  await page.addInitScript(() => {
    class FakeAudio {
      src = ''; onended: (() => void) | null = null; onerror: (() => void) | null = null
      load() {}
      play() { return Promise.resolve() }
      pause() {}
    }
    ;(window as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio
    const sent: Record<string, unknown>[] = []
    ;(window as unknown as { __editMessages: typeof sent }).__editMessages = sent
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
        sent.push(value)
        if (value.type === 'start_turn') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', session_id: 's1', turn_id: 't1', seq: 1 }) }), 0)
      }
      close() { this.readyState = 3 }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/voice/tts') { ttsBodies.push(request.postDataJSON()); return route.fulfill({ contentType: 'audio/mpeg', body: 'fake-audio' }) }
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/sessions/s1') return route.fulfill({ json: session })
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [{ id: 's1', title: 'Branches' }] } })
    if (path === '/api/sessions/s1/branch-selection') {
      const body = request.postDataJSON()
      selections.push(body)
      session.preferences.selected_branches = body.selected_branches
      return route.fulfill({ json: body })
    }
    if (path.startsWith('/api/sessions/s1/messages/')) {
      const id = path.split('/').pop() || ''
      deletions.push(id)
      session.messages = session.messages.filter(message => message.id !== Number(id) && message.parent_message_id !== Number(id))
      return route.fulfill({ json: { deleted: true, was_active: false, attachment_ids: [] } })
    }
    if (path === '/api/knowledge-bases/list') return route.fulfill({ json: [] })
    if (path === '/api/personas' || path === '/api/skills/list') return route.fulfill({ json: { personas: [], skills: [] } })
    if (path === '/api/partners' || path === '/api/capabilities/registered') return route.fulfill({ json: [] })
    if (path === '/api/space/mcp/servers') return route.fulfill({ json: { servers: {} } })
    if (path === '/api/notebooks') return route.fulfill({ json: { notebooks: [] } })
    return route.fulfill({ json: {} })
  })

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/chat/s1')
  await expect(page.locator('[data-chat-message-id]')).toHaveCount(6)
  await expect(page.locator('.chat-turn-navigator nav button')).toHaveCount(3)
  await page.getByRole('button', { name: '3. Third question', exact: true }).click()
  await expect(page.getByRole('button', { name: '3. Third question', exact: true })).toHaveAttribute('aria-current', 'true')

  const originalUser = page.locator('[data-chat-message-id="3"]')
  await originalUser.getByRole('button', { name: '编辑', exact: true }).click()
  const inlineEditor = originalUser.locator('.chat-inline-edit textarea')
  await expect(inlineEditor).toBeVisible()
  await expect(page.locator('form.composer textarea')).toHaveValue('')
  await inlineEditor.press('Escape')
  await expect(originalUser.locator('.chat-inline-edit')).toHaveCount(0)
  await originalUser.getByRole('button', { name: '编辑', exact: true }).click()
  await inlineEditor.fill('Original follow-up edited inline')
  await inlineEditor.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __editMessages: Record<string, unknown>[] }).__editMessages.length)).toBe(1)
  const edited = await page.evaluate(() => (window as unknown as { __editMessages: Record<string, unknown>[] }).__editMessages[0])
  expect(edited.content).toBe('Original follow-up edited inline')
  expect(edited.regenerate).toBe(true)
  expect(edited.parent_message_id).toBe(2)
  expect(edited.regenerated_from_message_id).toBe(3)

  await page.locator('[data-chat-message-id="3"]').getByRole('button', { name: '下一个分支' }).click()
  await expect.poll(() => selections.length).toBe(1)
  expect(selections[0]).toEqual({ selected_branches: { '2': 7 } })
  await expect(page.locator('[data-chat-message-id]')).toHaveCount(4)
  await expect(page.locator('[data-chat-message-id="8"]')).toContainText('Edited answer')
  await expect(page.locator('.chat-turn-navigator')).toHaveCount(0)

  const editedAnswer = page.locator('[data-chat-message-id="8"]')
  await page.getByRole('button', { name: '上下文窗口：已用 64%', exact: true }).click()
  const budgetPanel = page.getByRole('dialog', { name: '上下文窗口', exact: true })
  await expect(budgetPanel).toBeVisible()
  await expect(budgetPanel).toContainText('640 / 1k（64%）')
  await expect(budgetPanel.locator('.context-budget-segments > div')).toHaveCount(3)
  await expect(budgetPanel.locator('footer p')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(budgetPanel).toHaveCount(0)

  const usageTrigger = editedAnswer.getByRole('button', { name: /140 Token/ })
  await usageTrigger.click()
  const usagePanel = page.getByRole('dialog', { name: 'Token 用量与性能' })
  await expect(usagePanel).toBeVisible()
  await expect(usagePanel.locator('dl > div')).toHaveCount(10)
  await expect(usagePanel.locator('.chat-usage-total')).toContainText('140')
  await usagePanel.getByRole('button', { name: '本次会话', exact: true }).click()
  await expect(usagePanel.locator('.chat-usage-total')).toContainText('1,140')
  await page.keyboard.press('Escape')
  await expect(usagePanel).toHaveCount(0)
  await expect(usageTrigger).toBeFocused()

  await editedAnswer.getByRole('button', { name: '复制', exact: true }).click()
  await expect(editedAnswer.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
  await editedAnswer.getByRole('button', { name: '朗读', exact: true }).click()
  await expect(editedAnswer.getByRole('button', { name: '停止朗读', exact: true })).toBeVisible()
  expect(ttsBodies).toEqual([{ text: 'Edited answer' }])
  await editedAnswer.getByRole('button', { name: '停止朗读', exact: true }).click()
  await expect(editedAnswer.getByRole('button', { name: '朗读', exact: true })).toBeVisible()
  await editedAnswer.getByRole('button', { name: '删除本轮对话' }).click()
  expect(deletions).toEqual([])
  await editedAnswer.locator('.chat-delete-confirm .danger').click()
  await expect.poll(() => deletions).toEqual(['7'])
  await expect(page.locator('[data-chat-message-id]')).toHaveCount(6)
  await expect(page.locator('[data-chat-message-id="3"]')).toContainText('Original follow-up')
})
