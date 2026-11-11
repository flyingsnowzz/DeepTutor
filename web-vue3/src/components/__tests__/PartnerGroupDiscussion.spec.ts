import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PartnerGroupDiscussion from '../PartnerGroupDiscussion.vue'
import { api } from '../../api'
import type { GroupMessage, PartnerGroup } from '../../groupDiscussion'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  sent: Array<Record<string, unknown>> = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  onclose?: () => void
  constructor(public url: string) {
    FakeSocket.instances.push(this)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as Record<string, unknown>)
  }
  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

const group: PartnerGroup = {
  group_id: 'g1',
  name: 'Reasoning panel',
  member_ids: ['ada', 'alan'],
  discussion_mode: 'panel_parallel',
  members: [
    { partner_id: 'ada', name: 'Ada Lovelace' },
    { partner_id: 'alan', name: 'Alan Turing' },
  ],
}

const history: GroupMessage[] = [
  {
    event_id: 'u1',
    turn_id: 't1',
    session_key: 's1',
    role: 'user',
    content: 'Compare deduction and induction',
    author_id: 'user',
    author_name: 'You',
    created_at: '',
    mentions: [],
    error: false,
    kind: 'message',
    events: [],
    invocation_id: '',
    invocation: null,
  },
  {
    event_id: 'a1',
    turn_id: 't1',
    session_key: 's1',
    role: 'partner',
    content: 'Deduction starts from a rule.',
    author_id: 'ada',
    author_name: 'Ada Lovelace',
    created_at: '',
    mentions: [],
    error: false,
    kind: 'message',
    events: [{ type: 'content', content: 'Deduction starts from a rule.' }],
    invocation_id: 'inv1',
    invocation: {
      invocation_id: 'inv1',
      requester_partner_id: 'ada',
      requester_partner_name: 'Ada Lovelace',
      target_partner_id: 'alan',
      target_partner_name: 'Alan Turing',
      question: 'Can you compare that with induction?',
      status: 'pending',
    },
  },
]

describe('PartnerGroupDiscussion', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
    apiMock.mockReset()
    apiMock.mockImplementation(async path => {
      if (String(path).includes('/history?')) return history
      if (String(path).endsWith('/whiteboard')) return [{
        entry_id: 'w1',
        turn_id: 't1',
        session_key: 's1',
        author_id: 'ada',
        author_name: 'Ada Lovelace',
        content: 'Rule: every implication has a premise.',
        mentions: [],
        created_at: '',
      }]
      return {}
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders rounds and traces, approves peer invocations, sends resolved mentions and opens the whiteboard', async () => {
    const wrapper = mount(PartnerGroupDiscussion, {
      props: {
        groupId: 'g1',
        sessionKey: 's1',
        initialGroup: group,
        panelOpen: true,
      },
      global: {
        stubs: {
          ChatTurnNavigator: true,
          TurnActivityStream: { props: ['events'], template: '<div data-test="trace">{{ events.length }}</div>' },
        },
      },
    })
    await flushPromises()
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(1))
    const socket = FakeSocket.instances[0]!
    await vi.waitFor(() => expect(socket.sent.some(frame => frame.action === 'attach')).toBe(true))
    expect(socket.url).toMatch(/^ws:\/\//)
    expect(wrapper.text()).toContain('Compare deduction and induction')
    expect(wrapper.text()).toContain('Deduction starts from a rule.')
    expect(wrapper.text()).toContain('Can you compare that with induction?')

    await wrapper.get('.group-invocation-actions .primary').trigger('click')
    expect(socket.sent).toContainEqual(expect.objectContaining({
      action: 'approve_invocation',
      invocation_id: 'inv1',
      session_key: 's1',
    }))

    await wrapper.get('[data-group-composer]').setValue('@Ada Lovelace What is the premise?')
    await wrapper.get('.group-discussion-composer').trigger('submit.prevent')
    expect(socket.sent).toContainEqual(expect.objectContaining({
      content: '@Ada Lovelace What is the premise?',
      session_key: 's1',
      mentions: ['ada'],
    }))

    const contextTab = wrapper.findAll('.group-discussion-panel header button').find(button => button.text() === '共享上下文')
    await contextTab?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Rule: every implication has a premise.')
  })

  it('folds live traces into stable seats and shows stop while a round is running', async () => {
    apiMock.mockImplementation(async path => String(path).includes('/history?') ? [] : {})
    const wrapper = mount(PartnerGroupDiscussion, {
      props: { groupId: 'g1', sessionKey: 's1', initialGroup: group },
      global: { stubs: { ChatTurnNavigator: true } },
    })
    await flushPromises()
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(1))
    const socket = FakeSocket.instances[0]!
    await vi.waitFor(() => expect(socket.readyState).toBe(1))
    socket.emit({
      type: 'user_message',
      message: {
        ...history[0],
        event_id: 'u2',
        turn_id: 't2',
        content: 'Why does induction need a base case?',
        mentions: ['alan'],
      },
    })
    socket.emit({
      type: 'partner_trace',
      turn_id: 't2',
      partner_id: 'alan',
      event: { type: 'content', content: 'A base case anchors the chain.' },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('A base case anchors the chain.')
    expect(wrapper.get('.group-stop')).toBeTruthy()
    await wrapper.get('.group-stop').trigger('click')
    expect(socket.sent).toContainEqual(expect.objectContaining({ action: 'cancel', session_key: 's1' }))
  })
})
