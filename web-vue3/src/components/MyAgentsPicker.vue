<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import { api } from '../api'
import { getAgents, type ImportAgent } from '../imports/chat-import/agent-store'
import { assignSessionsToAgents, readImportMeta } from '../imports/chat-import/attribution'
import { projectLabel, SOURCE_LABEL } from '../imports/chat-import/shared'
import { listImportedSessions, type ImportedSession } from '../importsApi'

interface Row { id: string; title: string; lastMessage: string; messageCount: number; updatedAt: number; ownerKey: string; groupKey: string; groupLabel: string; source: string }
interface SelectedAgentSession { sessionId: string; title: string }
const props = withDefaults(defineProps<{ open: boolean; initial: SelectedAgentSession[]; everyTurn?: boolean }>(), { everyTurn: false })
const emit = defineEmits<{ close: []; apply: [sessions: SelectedAgentSession[]]; 'update:everyTurn': [value: boolean] }>()
const sessions = ref<ImportedSession[]>([])
const agents = ref<ImportAgent[]>([])
const selectedIds = ref<string[]>([])
const query = ref('')
const activeOwner = ref('all')
const expanded = ref<Set<string>>(new Set())
const preview = ref<{ row: Row | null; loading: boolean; messages: Array<{ role: string; content: string }> }>({ row: null, loading: false, messages: [] })
const loading = ref(false)
const rows = computed<Row[]>(() => {
  const ordered = [...agents.value].sort((a, b) => (b.lastSyncAt || b.createdAt) - (a.lastSyncAt || a.createdAt))
  const owners = assignSessionsToAgents(sessions.value, ordered)
  return sessions.value.flatMap(session => {
    const meta = readImportMeta(session as never)
    if (!meta) return []
    const id = session.session_id || session.id || ''
    const ownerKey = owners.get(id) || `ungrouped:${meta.source}`
    const group = meta.source === 'codex' ? new Date(session.created_at * 1000).toISOString().slice(0, 10) : meta.sourceCwd || SOURCE_LABEL[meta.source]
    return [{ id, title: session.title || '未命名会话', lastMessage: session.last_message || '', messageCount: session.message_count || 0, updatedAt: session.updated_at, ownerKey, groupKey: `${meta.source}:${group}`, groupLabel: meta.source === 'codex' ? group : projectLabel(group), source: meta.source }]
  })
})
const owners = computed(() => {
  const counts = new Map<string, number>()
  rows.value.forEach(row => counts.set(row.ownerKey, (counts.get(row.ownerKey) || 0) + 1))
  return [...counts.entries()].map(([key, count]) => ({ key, label: key.startsWith('ungrouped:') ? SOURCE_LABEL[key.slice(10) as keyof typeof SOURCE_LABEL] || key : agents.value.find(agent => agent.id === key)?.name || '未命名智能体', count }))
})
const filteredRows = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return rows.value.filter(row => (activeOwner.value === 'all' || row.ownerKey === activeOwner.value) && (!keyword || `${row.title} ${row.lastMessage}`.toLowerCase().includes(keyword)))
})
const groups = computed(() => {
  const map = new Map<string, { key: string; label: string; rows: Row[] }>()
  filteredRows.value.forEach(row => { const group = map.get(row.groupKey) || { key: row.groupKey, label: row.groupLabel, rows: [] }; group.rows.push(row); map.set(row.groupKey, group) })
  return [...map.values()]
})
async function load() {
  loading.value = true
  try { [sessions.value, agents.value] = await Promise.all([listImportedSessions(), getAgents()]) }
  catch { sessions.value = []; agents.value = [] } finally { loading.value = false }
}
function toggle(id: string) { selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(item => item !== id) : [...selectedIds.value, id] }
function groupState(group: { rows: Row[] }) { const ids = group.rows.map(row => row.id); const count = ids.filter(id => selectedIds.value.includes(id)).length; return count === 0 ? 'none' : count === ids.length ? 'all' : 'some' }
function toggleGroup(group: { rows: Row[] }) { const ids = group.rows.map(row => row.id); selectedIds.value = groupState(group) === 'all' ? selectedIds.value.filter(id => !ids.includes(id)) : [...new Set([...selectedIds.value, ...ids])] }
async function openPreview(row: Row) {
  preview.value = { row, loading: true, messages: [] }
  try { preview.value = { row, loading: false, messages: (await api<{ messages: Array<{ role: string; content: string }> }>(`/api/sessions/${encodeURIComponent(row.id)}`)).messages || [] } }
  catch { preview.value = { row, loading: false, messages: [] } }
}
function close() { emit('close') }
function apply() { emit('apply', rows.value.filter(row => selectedIds.value.includes(row.id)).map(row => ({ sessionId: row.id, title: row.title }))); close() }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
watch(() => props.open, open => { if (open) { selectedIds.value = props.initial.map(item => item.sessionId); query.value = ''; activeOwner.value = 'all'; expanded.value = new Set(); preview.value = { row: null, loading: false, messages: [] }; void load() } })
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template><Teleport to="body"><div v-if="open" class="picker-overlay" @click.self="close"><section class="agents-picker" role="dialog" aria-modal="true" aria-labelledby="agents-picker-title">
  <header><div class="picker-icon"><LegacyIcon name="agents" :size="18" /></div><div><h2 id="agents-picker-title">选择智能体会话</h2><p>选择智能体，再挑选要引入的对话。</p></div><ResourceReuseToggle :every-turn="everyTurn" @update:every-turn="emit('update:everyTurn', $event)" /><button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="18" /></button></header>
  <div class="agents-picker-toolbar"><div class="picker-search"><LegacyIcon name="search" :size="15" /><input v-model="query" type="search" placeholder="搜索智能体对话" /></div><div class="agents-owner-chips"><button type="button" :aria-pressed="activeOwner === 'all'" @click="activeOwner = 'all'">全部（{{ rows.length }}）</button><button v-for="owner in owners" :key="owner.key" type="button" :aria-pressed="activeOwner === owner.key" @click="activeOwner = owner.key">{{ owner.label }}（{{ owner.count }}）</button></div></div>
  <div class="agents-picker-body"><div class="agents-groups"><div v-if="loading" class="picker-loading"><span class="mastery-spinner" /></div><div v-else-if="!groups.length" class="picker-empty">没有找到导入的智能体会话</div><section v-for="group in groups" v-else :key="group.key"><div class="agents-group-heading"><button type="button" @click="toggleGroup(group)"><LegacyIcon :name="groupState(group) === 'all' ? 'check' : groupState(group) === 'some' ? 'minus' : 'folder'" :size="13" /></button><button type="button" @click="expanded.has(group.key) ? expanded.delete(group.key) : expanded.add(group.key)"><LegacyIcon name="chevronRight" :size="14" :class="{ expanded: expanded.has(group.key) || query }" />{{ group.label }}<small>{{ group.rows.length }}</small></button></div><div v-if="expanded.has(group.key) || query" class="agents-group-rows"><div v-for="row in group.rows" :key="row.id" class="agents-row"><button type="button" class="agents-row-select" :class="{ selected: selectedIds.includes(row.id) }" @click="toggle(row.id)"><span class="history-check"><LegacyIcon v-if="selectedIds.includes(row.id)" name="check" :size="12" /></span><span><strong>{{ row.title }}</strong><small>{{ row.messageCount }} 条消息</small><p v-if="row.lastMessage">{{ row.lastMessage }}</p></span></button><button type="button" class="agents-row-preview" aria-label="预览" @click="openPreview(row)"><LegacyIcon name="search" :size="14" /></button></div></div></section></div>
    <aside class="agents-preview"><template v-if="preview.row"><h3>{{ preview.row.title }}</h3><div v-if="preview.loading" class="picker-loading"><span class="mastery-spinner" /></div><p v-for="(message, index) in preview.messages.slice(0, 12)" v-else :key="index" class="history-preview-message" :class="message.role"><small>{{ message.role === 'user' ? '你' : message.role }}</small><span>{{ message.content }}</span></p></template><p v-else class="picker-empty">选择“预览”查看会话内容</p></aside>
  </div><footer><span>已选择 {{ selectedIds.length }} 段对话</span><div><button type="button" @click="selectedIds = []">清空</button><button type="button" :disabled="!selectedIds.length" @click="apply">使用所选（{{ selectedIds.length }}）</button></div></footer>
</section></div></Teleport></template>
