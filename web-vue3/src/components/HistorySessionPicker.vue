<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import { api } from '../api'

interface SessionSummary { id?: string; session_id: string; title: string; created_at: number; updated_at: number; message_count: number; last_message?: string; status?: string; match_excerpt?: string }
interface SelectedHistorySession { sessionId: string; title: string }
const props = withDefaults(defineProps<{ open: boolean; initial: SelectedHistorySession[]; everyTurn?: boolean }>(), { everyTurn: false })
const emit = defineEmits<{ close: []; apply: [sessions: SelectedHistorySession[]]; 'update:everyTurn': [value: boolean] }>()
const sessions = ref<SessionSummary[]>([])
const details = ref<Record<string, { title: string; messages: Array<{ role: string; content: string }> }>>({})
const selected = ref<Record<string, SessionSummary>>({})
const query = ref('')
const searchResults = ref<SessionSummary[]>([])
const loading = ref(false)
const detailsLoading = ref(false)
const activeId = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchGeneration = 0
let previousFocus: HTMLElement | null = null
const visibleSessions = computed(() => query.value.trim() ? searchResults.value : sessions.value)
const activeSession = computed(() => visibleSessions.value.find(session => sessionKey(session) === activeId.value) || visibleSessions.value[0] || null)
const activeDetail = computed(() => activeSession.value ? details.value[sessionKey(activeSession.value)] : undefined)
function sessionKey(session: SessionSummary) { return session.session_id || session.id || '' }
function title(session: SessionSummary) { return session.title || '新对话' }
function time(value?: number) { return value ? new Date(value * 1000).toLocaleString('zh-CN') : '' }
async function loadSessions() {
  loading.value = true
  try {
    const result = await api<{ sessions: SessionSummary[] }>('/api/sessions?limit=200&offset=0')
    sessions.value = result.sessions || []
    if (sessions.value.length) activeId.value = sessionKey(sessions.value[0])
    await Promise.all(props.initial.map(item => selected.value[item.sessionId] ? null : null))
  } catch { sessions.value = [] } finally { loading.value = false }
}
async function search() {
  const term = query.value.trim()
  const generation = ++searchGeneration
  if (!term) { searchResults.value = []; return }
  try {
    const result = await api<{ sessions: SessionSummary[] }>(`/api/sessions/search?q=${encodeURIComponent(term)}&limit=50&offset=0`)
    if (generation === searchGeneration) {
      searchResults.value = result.sessions || []
      if (searchResults.value.length) activeId.value = sessionKey(searchResults.value[0])
    }
  } catch { if (generation === searchGeneration) searchResults.value = [] }
}
async function activate(session: SessionSummary) {
  activeId.value = sessionKey(session)
  const key = sessionKey(session)
  if (!details.value[key]) {
    detailsLoading.value = true
    try {
      const detail = await api<{ title: string; messages: Array<{ role: string; content: string }> }>(`/api/sessions/${encodeURIComponent(key)}`)
      details.value[key] = detail
    } catch { details.value[key] = { title: title(session), messages: [] } } finally { detailsLoading.value = false }
  }
}
function toggle(session: SessionSummary) {
  const key = sessionKey(session)
  if (selected.value[key]) delete selected.value[key]
  else selected.value[key] = session
}
function clear() { selected.value = {} }
function close() { emit('close') }
function apply() {
  emit('apply', Object.values(selected.value).map(session => ({ sessionId: sessionKey(session), title: title(session) })))
  close()
}
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
watch(query, () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 250) })
watch(() => props.open, async open => {
  if (!open) return
  previousFocus = document.activeElement as HTMLElement | null
  document.body.style.overflow = 'hidden'
  selected.value = Object.fromEntries(props.initial.map(item => [item.sessionId, { session_id: item.sessionId, title: item.title, created_at: 0, updated_at: 0, message_count: 0 } as SessionSummary]))
  await loadSessions()
  await nextTick()
})
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => { document.removeEventListener('keydown', keydown); document.body.style.overflow = ''; clearTimeout(searchTimer); previousFocus?.focus() })
</script>

<template><Teleport to="body"><div v-if="open" class="picker-overlay" role="presentation" @click.self="close"><section class="history-picker" role="dialog" aria-modal="true" aria-labelledby="history-picker-title">
  <header><div class="picker-icon"><LegacyIcon name="history" :size="18" /></div><div><h2 id="history-picker-title">选择对话记录</h2><p>把历史会话作为本轮回答的上下文。</p></div><ResourceReuseToggle :every-turn="everyTurn" @update:every-turn="emit('update:everyTurn', $event)" /><button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="18" /></button></header>
  <div class="history-picker-toolbar"><div class="picker-search"><LegacyIcon name="search" :size="15" /><input v-model="query" data-autofocus type="search" placeholder="搜索对话、消息或结论" /></div><button v-if="Object.keys(selected).length" type="button" class="picker-clear" @click="clear">清空</button></div>
  <div class="history-picker-body">
    <div class="history-session-list"><div v-if="loading" class="picker-loading"><span class="mastery-spinner" /></div><div v-else-if="!visibleSessions.length" class="picker-empty">没有找到对话</div><button v-for="session in visibleSessions" :key="sessionKey(session)" type="button" class="history-session-row" :class="{ active: sessionKey(session) === activeId, selected: selected[sessionKey(session)] }" @click="toggle(session)" @mouseenter="activate(session)" @focus="activate(session)"><span class="history-check"><LegacyIcon v-if="selected[sessionKey(session)]" name="check" :size="13" /></span><span class="history-session-copy"><strong>{{ title(session) }}</strong><small>{{ session.message_count || 0 }} 条消息 · {{ time(session.updated_at) }}</small><p>{{ session.match_excerpt || session.last_message || '暂无摘要' }}</p></span></button></div>
    <aside class="history-preview"><h3>{{ activeSession ? title(activeSession) : '对话预览' }}</h3><div v-if="detailsLoading" class="picker-loading"><span class="mastery-spinner" /></div><template v-else-if="activeDetail"><p v-for="(message, index) in activeDetail.messages.slice(0, 12)" :key="index" class="history-preview-message" :class="message.role"><small>{{ message.role === 'user' ? '你' : 'DeepTutor' }}</small><span>{{ message.content }}</span></p></template><p v-else class="picker-empty">将鼠标移到左侧会话上查看内容</p></aside>
  </div>
  <footer><span>{{ Object.keys(selected).length }} 项已选择</span><div><button type="button" @click="close">取消</button><button type="button" class="primary" @click="apply">添加到消息</button></div></footer>
</section></div></Teleport></template>
