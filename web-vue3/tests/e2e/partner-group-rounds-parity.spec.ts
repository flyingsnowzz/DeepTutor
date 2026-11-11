import { expect, test } from '@playwright/test'

test('partner group renders stable seats, resolves mentions and approves peer invocations', async ({ page }) => {
  const group = {
    group_id: 'g1',
    owner_id: 'u',
    name: 'Study Council',
    description: 'Two tutors reviewing one plan',
    discussion_mode: 'panel_parallel',
    emoji: '📚',
    color: '#b0501e',
    shared_memory: 'whiteboard',
    member_ids: ['p1', 'p2'],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    version: 1,
    members: [
      { partner_id: 'p1', name: 'Ada Lovelace', emoji: '🦊', color: '#b0501e', description: 'Math tutor' },
      { partner_id: 'p2', name: 'Alan Turing', emoji: '🐳', color: '#3d6b8a', description: 'Logic tutor' },
    ],
  }
  const history = [
    {
      event_id: 'u1', turn_id: 't1', session_key: 's1', role: 'user',
      content: 'Compare deduction and induction', author_id: 'user', author_name: 'You',
      created_at: '2026-01-01', mentions: [], error: false, kind: 'message',
      events: [], invocation_id: '', invocation: null,
    },
    {
      event_id: 'a1', turn_id: 't1', session_key: 's1', role: 'partner',
      content: 'Deduction starts from a rule.', author_id: 'p1', author_name: 'Ada Lovelace',
      created_at: '2026-01-01', mentions: [], error: false, kind: 'message',
      events: [{ type: 'content', content: 'Deduction starts from a rule.' }],
      invocation_id: 'inv1',
      invocation: {
        invocation_id: 'inv1', requester_partner_id: 'p1', requester_partner_name: 'Ada Lovelace',
        target_partner_id: 'p2', target_partner_name: 'Alan Turing',
        question: 'Can you compare that with induction?', status: 'pending',
      },
    },
  ]
  await page.addInitScript(() => {
    class FakeWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null
      constructor(_url: string) {
        setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
      }
      send(raw: string) {
        const value = JSON.parse(raw)
        ;(window as unknown as { __groupCommands: unknown[] }).__groupCommands.push(value)
      }
      close() { this.readyState = 3; this.onclose?.() }
    }
    ;(window as unknown as { WebSocket: typeof FakeWebSocket; __groupCommands: unknown[] }).WebSocket = FakeWebSocket
    ;(window as unknown as { __groupCommands: unknown[] }).__groupCommands = []
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } })
    if (path === '/api/partner-groups') return route.fulfill({ json: [group] })
    if (path === '/api/partners') return route.fulfill({ json: group.members })
    if (path === '/api/partner-groups/g1') return route.fulfill({ json: group })
    if (path === '/api/partner-groups/g1/sessions') return route.fulfill({ json: [] })
    if (path === '/api/partner-groups/g1/history') return route.fulfill({ json: history })
    if (path === '/api/partner-groups/g1/whiteboard') return route.fulfill({ json: [] })
    if (path === '/api/settings/workspace/registrations') return route.fulfill({ json: { workspaces: [] } })
    if (path === '/api/settings/ui') return route.fulfill({ json: { language: 'zh', response_language: 'zh', theme: 'snow' } })
    return route.fulfill({ json: {} })
  })

  await page.goto('/partners/groups/g1')
  await expect(page.locator('.group-seat[data-seat="p1"]')).toContainText('Deduction starts from a rule.')
  await expect(page.locator('.group-invocation-card')).toContainText('Can you compare that with induction?')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __groupCommands: unknown[] }).__groupCommands.some(
    item => (item as { action?: string }).action === 'attach',
  ))).toBe(true)

  await page.getByRole('button', { name: '让他们讨论' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __groupCommands: unknown[] }).__groupCommands.some(
    item => (item as { action?: string; invocation_id?: string }).action === 'approve_invocation'
      && (item as { invocation_id?: string }).invocation_id === 'inv1',
  ))).toBe(true)

  await page.getByRole('textbox', { name: '发送群组消息' }).fill('@Ada Lovelace What is the premise?')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __groupCommands: unknown[] }).__groupCommands.find(
    item => (item as { content?: string }).content === '@Ada Lovelace What is the premise?',
  ))).toEqual(expect.objectContaining({ mentions: ['p1'], session_key: 'default' }))
})
