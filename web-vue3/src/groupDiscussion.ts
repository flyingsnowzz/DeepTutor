import { plainTextPreview, type ChatOutlineEntry } from './chatOutline'

export interface GroupMember {
  partner_id: string
  name: string
  description?: string
  emoji?: string
  color?: string
  avatar?: string
  running?: boolean
}

export interface PartnerGroup {
  group_id: string
  owner_id?: string
  name: string
  description?: string
  member_ids: string[]
  members?: GroupMember[]
  discussion_mode?: string
  shared_memory?: string
  emoji?: string
  color?: string
  created_at?: string
  updated_at?: string
  version?: number
}

export interface GroupInvocation {
  invocation_id: string
  group_id?: string
  session_key?: string
  parent_turn_id?: string
  requester_partner_id: string
  requester_partner_name: string
  target_partner_id: string
  target_partner_name: string
  question: string
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed' | string
  created_at?: string
  updated_at?: string
  question_event_id?: string
  reply_event_id?: string
  error?: string
}

export interface GroupStreamEvent {
  type?: string
  content?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export interface GroupMessage {
  event_id: string
  turn_id: string
  session_key: string
  role: 'user' | 'partner'
  content: string
  author_id: string
  author_name: string
  created_at: string
  mentions: string[]
  error: boolean
  kind: string
  events: GroupStreamEvent[]
  invocation_id: string
  invocation: GroupInvocation | null
}

export interface WhiteboardEntry {
  entry_id: string
  turn_id: string
  session_key: string
  author_id: string
  author_name: string
  content: string
  mentions: string[]
  created_at: string
}

export type SeatStatus = 'waiting' | 'working' | 'done' | 'error'

export interface GroupSeat {
  partnerId: string
  status: SeatStatus
  events: GroupStreamEvent[]
  streamed: string
  message?: GroupMessage
}

export interface GroupRound {
  turnId: string
  user?: GroupMessage
  seats: GroupSeat[]
  followup: boolean
  live: boolean
  stopped: boolean
}

export interface LiveGroupTurn {
  turnId: string
  targets: string[]
  seats: Record<string, GroupSeat>
  followup: boolean
}

export interface GroupDiscussionState {
  messages: GroupMessage[]
  live: LiveGroupTurn | null
  stoppedTurns: string[]
  error: string
}

export type GroupFrame =
  | { type: 'user_message'; message: GroupMessage }
  | { type: 'partner_started'; partner_id: string; invocation_id?: string }
  | {
      type: 'partner_trace'
      turn_id: string
      partner_id: string
      invocation_id?: string
      event: GroupStreamEvent
    }
  | { type: 'partner_message'; message: GroupMessage }
  | { type: 'invocation_updated'; invocation: GroupInvocation }
  | { type: 'done'; result?: Record<string, unknown> }
  | { type: 'cancelled'; content?: string }
  | { type: 'error'; content: string }

export interface ResolvedGroupMentions {
  targets: string[]
  members: GroupMember[]
  unknown: string[]
  everyone: boolean
}

const EVERYONE_TOKENS = new Set(['all', 'everyone', '所有人', '全部', '大家'])
const MENTION_TOKEN = /(?<![\w@])@([^\s@,，、:：;；!?！？。.]+)/g

export function emptyGroupSeat(partnerId: string): GroupSeat {
  return { partnerId, status: 'waiting', events: [], streamed: '' }
}

export function emptyGroupDiscussionState(): GroupDiscussionState {
  return { messages: [], live: null, stoppedTurns: [], error: '' }
}

function isFollowupKind(kind: string | null | undefined): boolean {
  return kind === 'invocation_question' || kind === 'invocation_reply'
}

function shouldAppendEventContent(event: GroupStreamEvent): boolean {
  if (event.type !== 'content') return false
  const meta = event.metadata || {}
  if (!meta.call_id) return true
  return meta.call_kind === 'llm_final_response' || meta.call_kind === 'agent_loop_round'
}

function growSeatBody(seat: GroupSeat, event: GroupStreamEvent): string {
  return shouldAppendEventContent(event)
    ? seat.streamed + (event.content || '')
    : seat.streamed
}

function appendMessage(messages: GroupMessage[], message: GroupMessage): GroupMessage[] {
  return messages.some(item => item.event_id === message.event_id)
    ? messages
    : [...messages, message]
}

export function applyGroupFrame(
  state: GroupDiscussionState,
  frame: GroupFrame,
  memberIds: string[],
): GroupDiscussionState {
  if (frame.type === 'user_message') {
    const targets = frame.message.mentions.length ? frame.message.mentions : memberIds
    return {
      ...state,
      messages: appendMessage(state.messages, frame.message),
      live: {
        turnId: frame.message.turn_id,
        targets,
        seats: Object.fromEntries(targets.map(id => [id, emptyGroupSeat(id)])),
        followup: false,
      },
      error: '',
    }
  }
  if (frame.type === 'partner_started') {
    const base = state.live || {
      turnId: '',
      targets: [frame.partner_id],
      seats: {},
      followup: Boolean(frame.invocation_id),
    }
    const seat = base.seats[frame.partner_id] || emptyGroupSeat(frame.partner_id)
    return {
      ...state,
      live: {
        ...base,
        targets: base.targets.includes(frame.partner_id)
          ? base.targets
          : [...base.targets, frame.partner_id],
        seats: {
          ...base.seats,
          [frame.partner_id]: { ...seat, status: 'working' },
        },
      },
    }
  }
  if (frame.type === 'partner_trace') {
    const base = state.live || {
      turnId: frame.turn_id,
      targets: [frame.partner_id],
      seats: {},
      followup: Boolean(frame.invocation_id),
    }
    const seat = base.seats[frame.partner_id] || emptyGroupSeat(frame.partner_id)
    return {
      ...state,
      live: {
        ...base,
        turnId: base.turnId || frame.turn_id,
        seats: {
          ...base.seats,
          [frame.partner_id]: {
            ...seat,
            status: 'working',
            streamed: growSeatBody(seat, frame.event),
            events: [...seat.events, frame.event],
          },
        },
      },
    }
  }
  if (frame.type === 'partner_message') {
    const seats = { ...(state.live?.seats || {}) }
    delete seats[frame.message.author_id]
    return {
      ...state,
      messages: appendMessage(state.messages, frame.message),
      live: state.live ? { ...state.live, seats } : null,
    }
  }
  if (frame.type === 'invocation_updated') {
    return {
      ...state,
      messages: state.messages.map(message =>
        message.invocation_id === frame.invocation.invocation_id
          ? { ...message, invocation: frame.invocation }
          : message,
      ),
    }
  }
  if (frame.type === 'cancelled' || frame.type === 'done') {
    return { ...state, live: null }
  }
  return { ...state, live: null, error: frame.content }
}

function seatPassRank(seat: GroupSeat, siblings: GroupSeat[]): number {
  const kind = seat.message?.kind
  if (kind === 'round_summary') return 2
  if (kind === 'debate_rebuttal') return 1
  if (seat.message) return 0
  const spoken = siblings.filter(item => item.message && item.partnerId === seat.partnerId).length
  return Math.min(spoken, 2)
}

export function buildGroupRounds(
  messages: GroupMessage[],
  live: LiveGroupTurn | null,
  memberIds: string[],
  stoppedTurns: string[] = [],
): GroupRound[] {
  const rounds = new Map<string, GroupRound>()
  for (const message of messages) {
    let round = rounds.get(message.turn_id)
    if (!round) {
      round = {
        turnId: message.turn_id,
        seats: [],
        followup: isFollowupKind(message.kind),
        live: false,
        stopped: stoppedTurns.includes(message.turn_id),
      }
      rounds.set(message.turn_id, round)
    }
    if (message.role === 'user') {
      round.user = message
      continue
    }
    if (message.kind === 'round_stopped') {
      round.stopped = true
      continue
    }
    if (isFollowupKind(message.kind)) round.followup = true
    round.seats.push({
      partnerId: message.author_id,
      status: message.error ? 'error' : 'done',
      events: message.events || [],
      streamed: '',
      message,
    })
  }
  if (live) {
    let round = rounds.get(live.turnId)
    if (!round) {
      round = {
        turnId: live.turnId || 'live',
        seats: [],
        followup: live.followup,
        live: true,
        stopped: false,
      }
      rounds.set(round.turnId, round)
    }
    round.live = true
    round.seats = [...round.seats, ...Object.values(live.seats)]
  }
  const seatRank = (seat: GroupSeat) => {
    const index = memberIds.indexOf(seat.partnerId)
    return index === -1 ? memberIds.length : index
  }
  return [...rounds.values()].map(round => ({
    ...round,
    seats: round.followup
      ? round.seats
      : [...round.seats].sort((left, right) =>
          seatPassRank(left, round.seats) - seatPassRank(right, round.seats)
          || seatRank(left) - seatRank(right)),
  }))
}

function aliasIndex(members: GroupMember[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const member of members) {
    index.set(member.partner_id.toLowerCase(), member.partner_id)
    if (member.name) index.set(member.name.toLowerCase(), member.partner_id)
  }
  return index
}

export function resolveGroupMentions(text: string, members: GroupMember[]): ResolvedGroupMentions {
  const aliases = aliasIndex(members)
  const targets: string[] = []
  const unknown: string[] = []
  let everyone = false
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const token = match[1] || ''
    const lower = token.toLowerCase()
    if (EVERYONE_TOKENS.has(lower)) {
      everyone = true
      continue
    }
    const direct = aliases.get(lower)
    if (direct) {
      if (!targets.includes(direct)) targets.push(direct)
      continue
    }
    const rest = text.slice((match.index || 0) + 1).toLowerCase()
    const spanned = [...aliases.keys()]
      .filter(alias => alias.includes(' ') && rest.startsWith(alias))
      .sort((left, right) => right.length - left.length)[0]
    if (spanned) {
      const id = aliases.get(spanned)
      if (id && !targets.includes(id)) targets.push(id)
      continue
    }
    if (!unknown.includes(token)) unknown.push(token)
  }
  const ordered = members
    .filter(member => targets.includes(member.partner_id))
    .map(member => member.partner_id)
  return {
    targets: everyone ? [] : ordered,
    members: members.filter(member => ordered.includes(member.partner_id)),
    unknown,
    everyone,
  }
}

export function activeMentionQuery(text: string): string | null {
  return /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1] ?? null
}

export function mentionSuggestions(query: string, members: GroupMember[]): GroupMember[] {
  const lower = query.toLowerCase()
  if (!lower) return members
  return members.filter(member =>
    member.name.toLowerCase().includes(lower)
    || member.partner_id.toLowerCase().includes(lower))
}

export function completeMention(text: string, member: GroupMember): string {
  return text.replace(/@[^\s@]*$/, `@${member.name || member.partner_id} `)
}

function firstGroupReply(round: GroupRound, skip: number): string {
  for (let index = skip; index < round.seats.length; index += 1) {
    const seat = round.seats[index]
    if (!seat) continue
    const preview = plainTextPreview(seat.message?.content ?? seat.streamed, 160)
    if (preview) return preview
  }
  return ''
}

export function buildGroupOutline(rounds: GroupRound[]): ChatOutlineEntry[] {
  const entries: Array<Omit<ChatOutlineEntry, 'weight'>> = []
  for (const round of rounds) {
    if (round.followup) {
      const question = round.seats[0]?.message
      const title = plainTextPreview(question?.content || '', 160)
      if (!title) continue
      const invocation = round.seats.find(seat => seat.message?.invocation)?.message?.invocation
      entries.push({
        key: round.turnId,
        index: entries.length,
        ordinal: entries.length + 1,
        title,
        reply: firstGroupReply(round, 1),
        capability: invocation
          ? `${invocation.requester_partner_name} → ${invocation.target_partner_name}`
          : question?.author_name,
      })
      continue
    }
    const title = plainTextPreview(round.user?.content || '', 160)
    if (!title) continue
    entries.push({
      key: round.turnId,
      index: entries.length,
      ordinal: entries.length + 1,
      title,
      reply: firstGroupReply(round, 0),
    })
  }
  const longest = Math.max(1, ...entries.map(entry => entry.title.length))
  return entries.map(entry => ({
    ...entry,
    weight: Math.max(0.18, entry.title.length / longest),
  }))
}
