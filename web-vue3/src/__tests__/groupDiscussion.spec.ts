import { describe, expect, it } from 'vitest'
import {
  activeMentionQuery,
  applyGroupFrame,
  buildGroupOutline,
  buildGroupRounds,
  completeMention,
  emptyGroupDiscussionState,
  mentionSuggestions,
  resolveGroupMentions,
  type GroupFrame,
  type GroupMember,
  type GroupMessage,
} from '../groupDiscussion'

const members: GroupMember[] = [
  { partner_id: 'ada', name: 'Ada Lovelace' },
  { partner_id: 'alan', name: 'Alan Turing' },
  { partner_id: 'grace', name: 'Grace Hopper' },
]

function message(patch: Partial<GroupMessage>): GroupMessage {
  return {
    event_id: 'e1',
    turn_id: 't1',
    session_key: 's1',
    role: 'partner',
    content: '',
    author_id: 'ada',
    author_name: 'Ada Lovelace',
    created_at: '',
    mentions: [],
    error: false,
    kind: 'message',
    events: [],
    invocation_id: '',
    invocation: null,
    ...patch,
  }
}

describe('group discussion', () => {
  it('resolves display names with spaces, aliases, everyone and unknown tokens', () => {
    const resolved = resolveGroupMentions('@Ada Lovelace and @alan, ask @everyone about @bob', members)
    expect(resolved.targets).toEqual([])
    expect(resolved.members.map(member => member.name)).toEqual(['Ada Lovelace', 'Alan Turing'])
    expect(resolved.everyone).toBe(true)
    expect(resolved.unknown).toEqual(['bob'])
  })

  it('drives the @ menu and completes the active mention', () => {
    expect(activeMentionQuery('question @gra')).toBe('gra')
    expect(mentionSuggestions('gra', members).map(member => member.partner_id)).toEqual(['grace'])
    expect(completeMention('question @gra', members[2]!)).toBe('question @Grace Hopper ')
  })

  it('merges parallel seats in stable member order and folds live traces', () => {
    const user = message({ event_id: 'u1', role: 'user', content: 'Compare approaches', author_id: 'user' })
    let state = emptyGroupDiscussionState()
    state = applyGroupFrame(state, { type: 'user_message', message: user }, members.map(member => member.partner_id))
    state = applyGroupFrame(state, { type: 'partner_trace', turn_id: 't1', partner_id: 'grace', event: { type: 'content', content: 'Grace draft' } }, [])
    state = applyGroupFrame(state, { type: 'partner_trace', turn_id: 't1', partner_id: 'ada', event: { type: 'content', content: 'Ada draft' } }, [])
    const rounds = buildGroupRounds(state.messages, state.live, members.map(member => member.partner_id), state.stoppedTurns)
    expect(rounds[0]?.seats.map(seat => seat.partnerId)).toEqual(['ada', 'alan', 'grace'])
    expect(rounds[0]?.seats.find(seat => seat.partnerId === 'grace')?.streamed).toBe('Grace draft')
  })

  it('moves a live seat to the persisted message without duplicating the answer', () => {
    let state = emptyGroupDiscussionState()
    const user = message({ event_id: 'u1', role: 'user', content: 'Why?', author_id: 'user' })
    state = applyGroupFrame(state, { type: 'user_message', message: user }, ['ada'])
    state = applyGroupFrame(state, { type: 'partner_started', partner_id: 'ada' }, ['ada'])
    const answer = message({ event_id: 'a1', author_id: 'ada', content: 'Because.' })
    state = applyGroupFrame(state, { type: 'partner_message', message: answer }, ['ada'])
    const rounds = buildGroupRounds(state.messages, state.live, ['ada'], [])
    expect(rounds[0]?.seats).toHaveLength(1)
    expect(rounds[0]?.seats[0]?.message?.content).toBe('Because.')
  })

  it('builds a rail for user rounds and peer follow-ups', () => {
    const user = message({ event_id: 'u1', role: 'user', content: 'First question', author_id: 'user' })
    const answer = message({ event_id: 'a1', turn_id: 't1', content: 'First answer' })
    const invocationQuestion = message({ event_id: 'q1', turn_id: 't2', content: 'Ask Alan', kind: 'invocation_question' })
    const reply = message({ event_id: 'r1', turn_id: 't2', author_id: 'alan', content: 'Peer answer', kind: 'invocation_reply' })
    const rounds = buildGroupRounds([user, answer, invocationQuestion, reply], null, ['ada', 'alan'], [])
    const outline = buildGroupOutline(rounds)
    expect(outline.map(entry => entry.title)).toEqual(['First question', 'Ask Alan'])
    expect(outline[1]?.reply).toBe('Peer answer')
  })

  it('clears transient seats on terminal frames and keeps invocation updates', () => {
    const pending = message({
      event_id: 'p1',
      invocation_id: 'inv1',
      invocation: {
        invocation_id: 'inv1',
        requester_partner_id: 'ada',
        requester_partner_name: 'Ada Lovelace',
        target_partner_id: 'alan',
        target_partner_name: 'Alan Turing',
        question: 'What do you think?',
        status: 'pending',
      },
    })
    let state = { ...emptyGroupDiscussionState(), messages: [pending] }
    const update: GroupFrame = {
      type: 'invocation_updated',
      invocation: { ...pending.invocation!, status: 'rejected' },
    }
    state = applyGroupFrame(state, update, [])
    expect(state.messages[0]?.invocation?.status).toBe('rejected')
    state = applyGroupFrame({ ...state, live: { turnId: 't1', targets: [], seats: {}, followup: false } }, { type: 'done' }, [])
    expect(state.live).toBeNull()
  })
})
