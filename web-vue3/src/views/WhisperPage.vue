<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { scopedUrl } from '../workspaceScope'
import MarkdownView from '../components/MarkdownView.vue'
import LegacyIcon from '../components/LegacyIcon.vue'

type Seat = 'visitor' | 'trainee'
interface Message { id: string; role: 'user' | 'assistant' | 'system'; text: string; stage?: string; source?: string; localSeat?: Seat }
interface Event { type: string; content?: string; stage?: string; source?: string; session_id?: string; turn_id?: string; seq?: number; metadata?: Record<string, unknown>; message?: string }
const capability = ref<'loading' | 'available' | 'missing'>('loading')
const seat = ref<Seat>('visitor')
const roomId = ref('')
const messages = ref<Message[]>([])
const draft = ref('')
const busy = ref(false)
const closed = ref(false)
const crisis = ref(false)
const connected = ref(false)
const everConnected = ref(false)
const sessionIds = ref<Record<Seat, string>>({ visitor: '', trainee: '' })
const copied = ref(false)
const scroller = ref<HTMLElement | null>(null)
const visibleMessages = computed(() => seat.value === 'trainee' ? messages.value : messages.value.filter(item => item.stage !== 'whisper' && !(item.source === 'whisper_trainee' && item.stage === 'debrief')))
const sendBlocked = computed(() => busy.value || closed.value || crisis.value || (seat.value === 'trainee' && !roomId.value))
let socket: WebSocket | null = null
let retry: ReturnType<typeof setTimeout> | undefined
let watchdog: ReturnType<typeof setTimeout> | undefined
let disposed = false
function add(role: Message['role'], text: string, extras: Partial<Message> = {}) { messages.value.push({ id: crypto.randomUUID(), role, text, ...extras }); void nextTick(() => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight }) }
function onEvent(event: Event) {
  if (event.type === 'session' || event.type === 'session_meta') { const id = String(event.metadata?.session_id || event.session_id || ''); if (id) sessionIds.value[seat.value] = id; return }
  if (event.type === 'done') { busy.value = false; if (watchdog) clearTimeout(watchdog); return }
  if (event.type === 'protocol_error' || event.type === 'error') { add('system', event.content || event.message || '请求失败'); busy.value = false; return }
  if (event.type !== 'content' || !event.content) return
  const text = event.content
  add('assistant', text, { stage: event.stage, source: event.source })
  if (!roomId.value) roomId.value = /room_id=([A-Za-z0-9_-]+)/.exec(text)?.[1] || ''
  const normalized = text.toLowerCase()
  if (['cannot provide crisis intervention', 'i am concerned you may be in danger', '不能做危机干预', '可能处于危险中', '转介', '热线', 'closed for crisis referral', 'no further counseling or whispers'].some(value => normalized.includes(value))) { crisis.value = true; closed.value = true }
  if (['whisper room has ended', '房间已结束', 'room has ended'].some(value => normalized.includes(value))) closed.value = true
}
function connect() {
  if (disposed || capability.value !== 'available' || socket && socket.readyState <= WebSocket.OPEN) return
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}${scopedUrl('/ws')}`)
  socket = ws
  ws.onopen = () => { if (socket === ws) { connected.value = true; everConnected.value = true } }
  ws.onmessage = message => { if (socket !== ws) return; try { onEvent(JSON.parse(message.data) as Event) } catch { /* Ignore invalid events. */ } }
  ws.onclose = () => { if (socket !== ws) return; socket = null; connected.value = false; if (!disposed) retry = setTimeout(connect, 500) }
  ws.onerror = () => { if (socket === ws) connected.value = false }
}
onMounted(async () => { try { const result = await api<{ capabilities: { id: string; available: boolean }[] }>('/api/capabilities/registered'); capability.value = result.capabilities.some(item => item.id === 'whisper_visitor' && item.available) ? 'available' : 'missing'; if (capability.value === 'available') connect() } catch { capability.value = 'missing' } })
onUnmounted(() => { disposed = true; if (retry) clearTimeout(retry); if (watchdog) clearTimeout(watchdog); socket?.close() })
function send(content = draft.value) {
  const text = content.trim(); if (!text || sendBlocked.value) return
  add('user', text, { localSeat: seat.value }); draft.value = ''; busy.value = true
  const payload = { protocol_version: '2.0', type: 'start_turn', content: text, client_submission_id: crypto.randomUUID(), capability: seat.value === 'visitor' ? 'whisper_visitor' : 'whisper_trainee', session_id: sessionIds.value[seat.value] || undefined, config: roomId.value ? { room_id: roomId.value } : {} }
  const transmit = (attempt: number) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload)); else if (attempt < 20) retry = setTimeout(() => transmit(attempt + 1), 250); else { busy.value = false; add('system', '连接失败，请重试。') } }
  transmit(0)
  if (watchdog) clearTimeout(watchdog)
  watchdog = setTimeout(() => { busy.value = false }, 120000)
}
function newRoom() { if (watchdog) clearTimeout(watchdog); messages.value = []; draft.value = ''; busy.value = false; closed.value = false; crisis.value = false; roomId.value = ''; seat.value = 'visitor'; sessionIds.value = { visitor: '', trainee: '' } }
function keydown(event: KeyboardEvent) { if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return; event.preventDefault(); send() }
async function copyRoom() { try { await navigator.clipboard.writeText(roomId.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* Clipboard access can be denied. */ } }
</script>

<template>
  <main v-if="capability === 'missing'" class="whisper-unavailable"><LegacyIcon name="activity" :size="24" /><h1>服务器尚未安装 Whisper</h1><p>练习室依赖单独的能力插件。请管理员安装后再使用。</p></main>
  <main v-else class="whisper-page"><header><div><div class="whisper-title"><LegacyIcon name="activity" :size="16" /><h1>Whisper</h1></div><p>双席督导 · 切换席位（非分屏）<span v-if="sessionIds[seat]" class="whisper-session">会话 {{ sessionIds[seat].slice(0, 8) }}…</span></p></div><div class="whisper-controls"><div v-if="roomId" class="whisper-room-chip"><span>房间</span><code>{{ roomId }}</code><button aria-label="复制房间 ID" @click="copyRoom"><LegacyIcon :name="copied ? 'check' : 'document'" :size="13" />{{ copied ? '已复制' : '复制' }}</button></div><button class="whisper-new-room" :disabled="!roomId && !closed && !crisis" @click="newRoom">新房间</button><div class="whisper-seat-tabs" role="tablist" aria-label="席位"><button v-for="value in (['visitor','trainee'] as Seat[])" :key="value" role="tab" :aria-selected="seat === value" @click="seat = value">{{ value === 'visitor' ? '来访者' : '咨询师' }}</button></div><small v-if="!connected">{{ everConnected ? '正在重连…' : '正在连接…' }}</small></div></header>
    <p v-if="closed || crisis" class="whisper-warning" role="status">{{ crisis ? '已触发危机转介，当前房间不可继续发送。' : '房间已结束，不可继续发送。' }}仍可复制房间 ID。</p><p v-if="seat === 'trainee' && !roomId" class="whisper-warning" role="status">请先以“来访者”身份发送第一条消息，获取房间 ID。</p>
    <div ref="scroller" class="whisper-messages"><div class="whisper-message-container"><div v-if="!visibleMessages.length" class="whisper-instructions"><strong>双席 Whisper · 3 步</strong><ol><li><b>来访者：</b>发送第一条消息，获取房间 ID。</li><li><b>咨询师：</b>切换席位发送咨询内容，私密督导提示带锁标识。</li><li><b>结束会话：</b>在咨询师席位结束房间并查看复盘。</li></ol><p>{{ seat === 'visitor' ? '当前是来访者席位，从第 1 步开始。' : '当前是咨询师席位，如还没有房间，请先完成来访者第 1 步。' }}</p></div><div v-for="item in visibleMessages" :key="item.id" class="whisper-message-row" :class="item.role"><div class="whisper-message" :class="[item.role, item.stage]"><small v-if="item.stage === 'whisper' || (item.stage && item.stage !== 'whisper') || (item.source && !['whisper_visitor', 'whisper_trainee'].includes(item.source)) || item.localSeat"><span v-if="item.stage === 'whisper'">🔒 whisper</span><span v-else-if="item.stage"> · {{ item.stage }}</span><span v-if="item.source && !['whisper_visitor', 'whisper_trainee'].includes(item.source)"> · {{ item.source }}</span><span v-if="item.localSeat"> · 你（{{ item.localSeat === 'visitor' ? '来访者' : '咨询师' }}）</span></small><MarkdownView v-if="item.role === 'assistant'" :content="item.text" /><p v-else>{{ item.text }}</p></div></div></div></div>
    <div class="whisper-composer"><div class="whisper-composer-main"><div class="whisper-input-row"><textarea v-model="draft" rows="2" :disabled="closed || crisis" :placeholder="seat === 'visitor' ? '以来访者身份发送消息…' : '以咨询师身份发送消息…'" :aria-label="seat === 'visitor' ? '来访者消息' : '咨询师消息'" @keydown="keydown" /><button class="primary" :disabled="sendBlocked || !draft.trim()" @click="send()"><LegacyIcon name="chevronRight" :size="15" />发送</button></div><p v-if="busy" class="whisper-waiting">正在等待…</p><div v-if="seat === 'trainee'" class="whisper-end-row"><button :disabled="sendBlocked || !roomId" @click="send('结束')">结束会话</button></div></div></div>
  </main>
</template>
