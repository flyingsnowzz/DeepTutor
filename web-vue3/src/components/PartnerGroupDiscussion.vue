<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PartnerAvatar from './PartnerAvatar.vue'
import LegacyIcon from './LegacyIcon.vue'
import TurnActivityStream from './TurnActivityStream.vue'
import ChatTurnNavigator from './ChatTurnNavigator.vue'
import PartnerGroupRound from './PartnerGroupRound.vue'
import { api } from '../api'
import { scopedWebSocketUrl } from '../workspaceScope'
import {
  activeMentionQuery,
  applyGroupFrame,
  buildGroupOutline,
  buildGroupRounds,
  completeMention,
  emptyGroupDiscussionState,
  mentionSuggestions,
  resolveGroupMentions,
  type GroupDiscussionState,
  type GroupFrame,
  type GroupMember,
  type GroupMessage,
  type PartnerGroup,
  type WhiteboardEntry,
} from '../groupDiscussion'

const props = withDefaults(defineProps<{
  groupId: string
  sessionKey: string
  initialGroup?: PartnerGroup | null
  panelOpen?: boolean
  embedded?: boolean
  consultationActive?: boolean
}>(), {
  initialGroup: null,
  panelOpen: false,
  embedded: false,
  consultationActive: false,
})
const emit = defineEmits<{
  'update:panelOpen': [value: boolean]
  'messages-change': [messages: GroupMessage[]]
  done: []
  error: [message: string]
  'consultation-activity': []
}>()

const group = ref<PartnerGroup | null>(props.initialGroup ? { ...props.initialGroup } : null)
const state = ref<GroupDiscussionState>(emptyGroupDiscussionState())
const loading = ref(true)
const connected = ref(false)
const pendingActions = ref<Set<string>>(new Set())
const whiteboard = ref<WhiteboardEntry[]>([])
const boardLoading = ref(false)
const panelTab = ref<'reasoning' | 'context'>('reasoning')
const traceFocus = ref<{ turnId: string; partnerId: string } | null>(null)
const thread = ref<HTMLElement | null>(null)
const input = ref('')
const quote = ref<{ name: string; content: string } | null>(null)
const suggestionIndex = ref(0)
const suggestionsDismissed = ref(false)
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined
let reconnectAttempt = 0
let disposed = false
let historyReady = false
let lastActivityReport = 0
let autoRun: { requester: string; target: string } | null = null

const members = computed<GroupMember[]>(() => group.value?.members || [])
const memberIds = computed(() => group.value?.member_ids?.length ? group.value.member_ids : members.value.map(member => member.partner_id))
const rounds = computed(() => buildGroupRounds(state.value.messages, state.value.live, memberIds.value, state.value.stoppedTurns))
const outline = computed(() => buildGroupOutline(rounds.value))
const running = computed(() => Boolean(state.value.live))
const progress = computed(() => {
  const live = state.value.live
  if (!live) return null
  const total = live.targets.length
  const answered = state.value.messages.filter(message => message.turn_id === live.turnId && message.role === 'partner').length
  return { done: Math.max(0, total - Object.keys(live.seats).length), total, clash: total > 0 && answered >= total }
})
const mentionQuery = computed(() => activeMentionQuery(input.value))
const mentionItems = computed(() =>
  mentionQuery.value === null || suggestionsDismissed.value
    ? []
    : mentionSuggestions(mentionQuery.value, members.value))
const resolvedMentions = computed(() => resolveGroupMentions(input.value, members.value))
const addressed = computed(() => resolvedMentions.value.everyone ? [] : resolvedMentions.value.members)
const canSend = computed(() => Boolean(input.value.trim()) && connected.value)
const tracedSeats = computed(() =>
  rounds.value.flatMap(round =>
    round.seats
      .filter(seat => seat.events.length > 0 || ['waiting', 'working'].includes(seat.status))
      .map(seat => ({ round, seat }))))
const panelVisible = computed(() => props.panelOpen)
const groupModeHint = computed(() => {
  const mode = group.value?.discussion_mode
  if (mode === 'sequential') return '问一次，伙伴们依次回答；后一位会看到前文并继续补充。'
  if (mode === 'debate') return '问一次，每位伙伴先表明立场，再回应彼此的分歧。'
  return '问一次，每位伙伴会从自己的角度回答。'
})

function setPanelOpen(value: boolean) {
  emit('update:panelOpen', value)
}

function memberOf(partnerId: string): GroupMember | undefined {
  return members.value.find(member => member.partner_id === partnerId)
}

function labelFor(kind?: string) {
  if (kind === 'debate_rebuttal') return '反驳'
  if (kind === 'round_summary') return '总结'
  if (kind === 'invocation_question' || kind === 'invocation_reply') return '追问'
  return ''
}

async function loadGroup() {
  if (props.initialGroup) {
    group.value = { ...props.initialGroup }
    return
  }
  try {
    group.value = await api<PartnerGroup>(`/api/partner-groups/${encodeURIComponent(props.groupId)}`)
  } catch (cause) {
    reportError(cause instanceof Error ? cause.message : '伙伴群组加载失败')
  }
}

async function loadHistory() {
  if (!props.groupId || !props.sessionKey) {
    loading.value = false
    return
  }
  loading.value = true
  historyReady = false
  state.value = emptyGroupDiscussionState()
  pendingActions.value = new Set()
  try {
    const messages = await api<GroupMessage[]>(
      `/api/partner-groups/${encodeURIComponent(props.groupId)}/history?limit=200&session_key=${encodeURIComponent(props.sessionKey)}`,
    )
    state.value = { ...emptyGroupDiscussionState(), messages }
  } catch (cause) {
    state.value = emptyGroupDiscussionState()
    reportError(cause instanceof Error ? cause.message : '群组讨论记录加载失败')
  } finally {
    loading.value = false
    historyReady = true
    attach()
    emit('messages-change', state.value.messages)
    await scrollToEnd()
  }
}

async function loadWhiteboard() {
  if (!props.groupId) return
  boardLoading.value = true
  try {
    const result = await api<WhiteboardEntry[] | { entries?: WhiteboardEntry[] }>(
      `/api/partner-groups/${encodeURIComponent(props.groupId)}/whiteboard`,
    )
    whiteboard.value = Array.isArray(result) ? result : result.entries || []
  } catch {
    whiteboard.value = []
  } finally {
    boardLoading.value = false
  }
}

function reportError(message: string) {
  state.value = { ...state.value, error: message }
  emit('error', message)
}

function sendFrame(command: Record<string, unknown>): boolean {
  const active = socket
  if (!active || active.readyState !== WebSocket.OPEN) return false
  active.send(JSON.stringify(command))
  return true
}

function attach() {
  if (!historyReady) return
  sendFrame({ action: 'attach', session_key: props.sessionKey })
}

function scheduleReconnect() {
  if (disposed || reconnectTimer) return
  const delay = Math.min(8_000, 500 * 2 ** reconnectAttempt)
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    connect()
  }, delay)
}

function connect() {
  if (disposed) return
  const previous = socket
  socket = null
  previous?.close()
  const active = new WebSocket(scopedWebSocketUrl(`/ws/partner-groups/${encodeURIComponent(props.groupId)}`))
  socket = active
  active.onopen = () => {
    if (socket !== active) return
    connected.value = true
    reconnectAttempt = 0
    attach()
    if (props.consultationActive) reportConsultationActivity(false)
  }
  active.onmessage = event => {
    if (socket !== active) return
    let frame: GroupFrame
    try { frame = JSON.parse(String(event.data)) as GroupFrame } catch { return }
    handleFrame(frame)
  }
  active.onerror = () => {
    if (socket === active) connected.value = false
  }
  active.onclose = () => {
    if (socket !== active) return
    connected.value = false
    scheduleReconnect()
  }
}

function handleFrame(frame: GroupFrame) {
  state.value = applyGroupFrame(state.value, frame, memberIds.value)
  if (frame.type === 'invocation_updated') {
    const invocation = frame.invocation
    if (pendingActions.value.has(invocation.invocation_id)) {
      const next = new Set(pendingActions.value)
      next.delete(invocation.invocation_id)
      pendingActions.value = next
    }
    const wanted = autoRun
    if (
      wanted
      && invocation.status === 'pending'
      && invocation.requester_partner_id === wanted.requester
      && invocation.target_partner_id === wanted.target
    ) {
      autoRun = null
      sendFrame({
        action: 'approve_invocation',
        invocation_id: invocation.invocation_id,
        session_key: props.sessionKey,
      })
    }
  }
  if (frame.type === 'done') {
    pendingActions.value = new Set()
    emit('done')
    if (panelVisible.value && panelTab.value === 'context') void loadWhiteboard()
  }
  if (frame.type === 'cancelled') pendingActions.value = new Set()
  if (frame.type === 'error') reportError(frame.content)
  emit('messages-change', state.value.messages)
  void scrollToEnd()
}

function sendMessage(): boolean {
  const draft = input.value.trim()
  if (!draft || !connected.value) {
    if (!connected.value) reportError('群组正在重新连接')
    return false
  }
  const content = quote.value
    ? `> ${quote.value.name}: ${quote.value.content.replace(/\n+/g, ' ').slice(0, 400)}\n\n${draft}`
    : draft
  const resolved = resolvedMentions.value
  const mentions = resolved.everyone ? [] : resolved.targets.length ? resolved.targets : null
  const ok = sendFrame({ content, session_key: props.sessionKey, mentions })
  if (!ok) {
    reportError('群组正在重新连接')
    return false
  }
  input.value = ''
  quote.value = null
  suggestionsDismissed.value = false
  reportConsultationActivity(true)
  return true
}

function actOnInvocation(invocationId: string, action: 'approve' | 'reject') {
  if (pendingActions.value.has(invocationId)) return
  const next = new Set(pendingActions.value)
  next.add(invocationId)
  pendingActions.value = next
  const ok = sendFrame({
    action: action === 'approve' ? 'approve_invocation' : 'reject_invocation',
    invocation_id: invocationId,
    session_key: props.sessionKey,
  })
  if (!ok) {
    next.delete(invocationId)
    pendingActions.value = new Set(next)
    reportError('群组正在重新连接')
  }
}

function askPeer(payload: { requesterId: string; targetId: string; content: string }) {
  const excerpt = payload.content.trim().slice(0, 400)
  const question = `这是我刚才的观点：“${excerpt}”。你怎么看？`
  autoRun = { requester: payload.requesterId, target: payload.targetId }
  const ok = sendFrame({
    action: 'create_invocation',
    session_key: props.sessionKey,
    requester_partner_id: payload.requesterId,
    target_partner_id: payload.targetId,
    question,
  })
  if (!ok) {
    autoRun = null
    reportError('群组正在重新连接')
  }
}

function summarizeRound(payload: { turnId: string; partnerId: string }) {
  if (!sendFrame({
    action: 'summarize_round',
    session_key: props.sessionKey,
    turn_id: payload.turnId,
    partner_id: payload.partnerId,
  })) reportError('群组正在重新连接')
}

function cancel() {
  if (!sendFrame({ action: 'cancel', session_key: props.sessionKey })) reportError('群组正在重新连接')
}

function complete(member: GroupMember) {
  input.value = completeMention(input.value, member)
  suggestionIndex.value = 0
  suggestionsDismissed.value = false
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('[data-group-composer]')?.focus())
}

function composerKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (mentionItems.value.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      suggestionIndex.value = (suggestionIndex.value + 1) % mentionItems.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      suggestionIndex.value = (suggestionIndex.value - 1 + mentionItems.value.length) % mentionItems.value.length
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      suggestionsDismissed.value = true
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      complete(mentionItems.value[suggestionIndex.value] || mentionItems.value[0]!)
      return
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

function quoteSpeech(payload: { member?: GroupMember; content: string }) {
  quote.value = {
    name: payload.member?.name || '伙伴',
    content: payload.content,
  }
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('[data-group-composer]')?.focus())
}

function openTrace(payload: { turnId: string; partnerId: string }) {
  panelTab.value = 'reasoning'
  traceFocus.value = payload
  setPanelOpen(true)
  void nextTick(() => {
    const target = document.querySelector<HTMLElement>(`[data-group-trace="${payload.turnId}:${payload.partnerId}"]`)
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function openPanelTab(tab: 'reasoning' | 'context') {
  panelTab.value = tab
  if (tab === 'context') void loadWhiteboard()
}

function jumpToRound(key: string) {
  const root = thread.value
  const target = root?.querySelector<HTMLElement>(`[data-turn-key="${key}"]`)
  if (!root || !target) return
  root.scrollTo({
    top: root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - 20,
    behavior: 'smooth',
  })
}

async function scrollToEnd() {
  await nextTick()
  if (thread.value) thread.value.scrollTop = thread.value.scrollHeight
}

function reportConsultationActivity(active: boolean, force = false) {
  if (!props.consultationActive || !connected.value) return
  const now = Date.now()
  if (!force && !active && now - lastActivityReport < 1_500) return
  lastActivityReport = now
  if (active) emit('consultation-activity')
  sendFrame({
    action: 'consultation_activity',
    session_key: props.sessionKey,
    has_draft: Boolean(input.value.trim() || quote.value),
    active,
  })
}

function markInteraction() {
  reportConsultationActivity(true)
}

watch(input, value => {
  if (activeMentionQuery(value) === null) suggestionsDismissed.value = false
  suggestionIndex.value = 0
  if (props.consultationActive) reportConsultationActivity(false)
})
watch(() => props.sessionKey, () => { void loadHistory() })
watch(() => props.groupId, () => {
  void loadGroup()
  void loadHistory()
  connect()
})
watch(() => props.initialGroup, value => {
  if (value) group.value = { ...value }
})
watch(() => props.consultationActive, active => {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = undefined
  if (!active) return
  reportConsultationActivity(false, true)
  heartbeatTimer = setInterval(() => reportConsultationActivity(false, true), 2_000)
})

onMounted(async () => {
  await loadGroup()
  void loadHistory()
  connect()
  if (props.consultationActive) {
    heartbeatTimer = setInterval(() => reportConsultationActivity(false, true), 2_000)
  }
})
onBeforeUnmount(() => {
  disposed = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  socket?.close()
  socket = null
})
</script>

<template>
  <section
    class="partner-group-discussion"
    :class="{ embedded, 'panel-open': panelVisible }"
    @pointerdown.capture="markInteraction"
    @keydown.capture="markInteraction"
  >
    <div class="group-discussion-main">
      <div class="group-discussion-scroll-wrap">
        <div ref="thread" class="group-discussion-scroll">
          <div class="group-discussion-column">
            <div v-if="loading" class="group-discussion-loading" role="status"><LegacyIcon name="loaderCircle" :size="18" /></div>
            <div v-else-if="!rounds.length" class="group-discussion-empty">
              <div class="group-empty-members">
                <div v-for="member in members" :key="member.partner_id">
                  <PartnerAvatar :name="member.name" :emoji="member.emoji" :color="member.color" :image="member.avatar" :size="40" />
                  <strong>{{ member.name }}</strong>
                  <span>{{ member.description }}</span>
                </div>
              </div>
              <h2>开始群组讨论</h2>
              <p>{{ groupModeHint }} 使用 @名字 缩小范围。</p>
            </div>
            <PartnerGroupRound
              v-for="round in rounds"
              :key="round.turnId"
              :round="round"
              :members="members"
              :progress="round.live ? progress : null"
              :pending-actions="pendingActions"
              @approve="actOnInvocation($event, 'approve')"
              @reject="actOnInvocation($event, 'reject')"
              @quote="quoteSpeech"
              @trace="openTrace"
              @ask-peer="askPeer"
              @summarize="summarizeRound"
            />
            <div v-if="state.error" class="group-discussion-error" role="alert">
              <LegacyIcon name="info" :size="13" />
              <div><strong>本轮未能完成</strong><p>{{ state.error }}</p></div>
            </div>
          </div>
        </div>
        <ChatTurnNavigator :entries="outline" :scroll-root="thread" @jump="jumpToRound" @bottom="scrollToEnd" />
      </div>
      <form class="group-discussion-composer" @submit.prevent="sendMessage">
        <div class="group-composer-addressing">
          <span><LegacyIcon name="atSign" :size="11" />{{ addressed.length ? `正在与 ${addressed.map(member => member.name).join('、')} 讨论` : '未提及 · 每位伙伴都会回答' }}</span>
          <span v-if="resolvedMentions.unknown.length" class="group-unknown-mentions">未识别：{{ resolvedMentions.unknown.map(name => `@${name}`).join(' ') }}</span>
        </div>
        <div v-if="mentionItems.length" class="group-mention-menu">
          <button
            v-for="(member, index) in mentionItems"
            :key="member.partner_id"
            type="button"
            :class="{ active: suggestionIndex === index }"
            @mousedown.prevent
            @click="complete(member)"
          >
            <PartnerAvatar :name="member.name" :emoji="member.emoji" :color="member.color" :image="member.avatar" :size="22" />
            <span>{{ member.name }}</span>
          </button>
        </div>
        <div v-if="quote" class="group-composer-quote">
          <div><small>正在追问 {{ quote.name }}</small><p>{{ quote.content }}</p></div>
          <button type="button" aria-label="移除引用" @click="quote = null">×</button>
        </div>
        <div class="group-composer-box">
          <textarea
            v-model="input"
            data-group-composer
            rows="1"
            maxlength="32000"
            aria-label="发送群组消息"
            placeholder="给群组发消息 · 输入 @ 选择伙伴"
            @keydown="composerKeydown"
          />
          <button v-if="running" type="button" class="group-stop" aria-label="停止" title="停止" @click="cancel"><LegacyIcon name="stop" :size="12" /></button>
          <button v-else type="submit" class="group-send" aria-label="发送" :disabled="!canSend"><LegacyIcon name="arrowUp" :size="15" /></button>
        </div>
      </form>
    </div>
    <aside v-if="panelVisible" class="group-discussion-panel group-side-panel">
      <header>
        <div>
          <button type="button" :class="{ active: panelTab === 'reasoning' }" @click="openPanelTab('reasoning')">推理步骤</button>
          <button type="button" :class="{ active: panelTab === 'context' }" @click="openPanelTab('context')">共享上下文</button>
        </div>
        <button type="button" aria-label="关闭" @click="setPanelOpen(false)"><LegacyIcon name="close" :size="15" /></button>
      </header>
      <div class="group-panel-content">
        <template v-if="panelTab === 'reasoning'">
          <p v-if="!tracedSeats.length" class="group-panel-empty">还没有可展示的推理步骤</p>
          <div v-else class="group-trace-list">
            <article
              v-for="row in tracedSeats"
              :key="`${row.round.turnId}:${row.seat.partnerId}`"
              :data-group-trace="`${row.round.turnId}:${row.seat.partnerId}`"
              :class="{ focused: traceFocus?.turnId === row.round.turnId && traceFocus?.partnerId === row.seat.partnerId }"
            >
              <header>
                <PartnerAvatar :name="row.seat.message?.author_name || memberOf(row.seat.partnerId)?.name || row.seat.partnerId" :emoji="memberOf(row.seat.partnerId)?.emoji" :color="memberOf(row.seat.partnerId)?.color" :image="memberOf(row.seat.partnerId)?.avatar" :size="18" />
                <strong>{{ row.seat.message?.author_name || memberOf(row.seat.partnerId)?.name || row.seat.partnerId }}</strong>
                <small>{{ row.round.followup ? '追问' : labelFor(row.seat.message?.kind) }}</small>
              </header>
              <TurnActivityStream :events="row.seat.events.map(event => ({ ...event, type: event.type || 'event' }))" />
            </article>
          </div>
        </template>
        <template v-else>
          <p class="group-panel-note group-side-context-note">群组内所有伙伴可见</p>
          <p v-if="boardLoading" class="group-panel-empty">正在加载共享白板…</p>
          <p v-else-if="!whiteboard.length" class="group-panel-empty">共享白板还是空的</p>
          <div v-else class="group-whiteboard">
            <article v-for="entry in whiteboard" :key="entry.entry_id">
              <small>{{ entry.author_name }}</small>
              <p>{{ entry.content }}</p>
            </article>
          </div>
        </template>
      </div>
    </aside>
  </section>
</template>
