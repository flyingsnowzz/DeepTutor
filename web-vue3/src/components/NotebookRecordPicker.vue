<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import { api } from '../api'
import type { NotebookRecord, NotebookSummary, SelectedNotebookRecord } from '../notebookReferences'

const props = withDefaults(defineProps<{ open: boolean; initial: SelectedNotebookRecord[]; everyTurn?: boolean }>(), { everyTurn: false })
const emit = defineEmits<{ close: []; apply: [records: SelectedNotebookRecord[]]; 'update:everyTurn': [value: boolean] }>()
const notebooks = ref<NotebookSummary[]>([])
const records = ref<Record<string, NotebookRecord[]>>({})
const expanded = ref<Set<string>>(new Set())
const loading = ref(false)
const loadingRecords = ref<Set<string>>(new Set())
const selected = ref<Map<string, SelectedNotebookRecord>>(new Map())
const selectedIds = computed(() => new Set(selected.value.keys()))
const groupedSelected = computed(() => {
  const groups = new Map<string, { name: string; count: number }>()
  selected.value.forEach(record => { const current = groups.get(record.notebookId); groups.set(record.notebookId, { name: record.notebookName, count: (current?.count || 0) + 1 }) })
  return [...groups.entries()].map(([id, group]) => ({ id, ...group }))
})
async function loadNotebooks() {
  loading.value = true
  try { notebooks.value = ((await api<{ notebooks: NotebookSummary[] }>('/api/notebooks')).notebooks || []).filter(notebook => (notebook.record_count || 0) > 0) }
  catch { notebooks.value = [] } finally { loading.value = false }
}
async function toggleNotebook(notebook: NotebookSummary) {
  const next = new Set(expanded.value)
  if (next.has(notebook.id)) next.delete(notebook.id)
  else {
    next.add(notebook.id)
    if (!records.value[notebook.id]) {
      loadingRecords.value = new Set([...loadingRecords.value, notebook.id])
      try { records.value = { ...records.value, [notebook.id]: (await api<{ records?: NotebookRecord[] }>(`/api/notebooks/${encodeURIComponent(notebook.id)}`)).records || [] } }
      catch { records.value = { ...records.value, [notebook.id]: [] } }
      finally { const pending = new Set(loadingRecords.value); pending.delete(notebook.id); loadingRecords.value = pending }
    }
  }
  expanded.value = next
}
function toggleRecord(notebook: NotebookSummary, record: NotebookRecord) {
  const next = new Map(selected.value)
  if (next.has(record.id)) next.delete(record.id)
  else next.set(record.id, { ...record, notebookId: notebook.id, notebookName: notebook.name })
  selected.value = next
}
function allSelected(notebookId: string) { const items = records.value[notebookId] || []; return items.length > 0 && items.every(record => selectedIds.value.has(record.id)) }
function toggleAll(notebook: NotebookSummary) {
  const next = new Map(selected.value)
  const items = records.value[notebook.id] || []
  if (allSelected(notebook.id)) items.forEach(record => next.delete(record.id))
  else items.forEach(record => next.set(record.id, { ...record, notebookId: notebook.id, notebookName: notebook.name }))
  selected.value = next
}
function clear() { selected.value = new Map() }
function close() { emit('close') }
function apply() { emit('apply', [...selected.value.values()]); close() }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
watch(() => props.open, open => { if (open) { selected.value = new Map(props.initial.map(record => [record.id, record])); expanded.value = new Set(); void loadNotebooks() } })
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template><Teleport to="body"><div v-if="open" class="picker-overlay" @click.self="close"><section class="notebook-record-picker" role="dialog" aria-modal="true" aria-labelledby="notebook-picker-title">
  <header><div class="picker-icon"><LegacyIcon name="bookmark" :size="18" /></div><div><h2 id="notebook-picker-title">选择收藏记录</h2><p>跨一个或多个收藏夹选择记录，作为下一轮请求的上下文。</p></div><ResourceReuseToggle :every-turn="everyTurn" @update:every-turn="emit('update:everyTurn', $event)" /><button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="18" /></button></header>
  <div class="notebook-picker-body"><div v-if="loading" class="picker-loading"><span class="mastery-spinner" /></div><div v-else-if="!notebooks.length" class="picker-empty">还没有可用的收藏记录</div><template v-else><section v-for="notebook in notebooks" :key="notebook.id" class="notebook-picker-group"><div class="notebook-picker-heading"><button type="button" :aria-expanded="expanded.has(notebook.id)" @click="toggleNotebook(notebook)"><LegacyIcon name="chevronRight" :size="14" :class="{ expanded: expanded.has(notebook.id) }" /><LegacyIcon name="bookmark" :size="15" /><strong>{{ notebook.name }}</strong><small>{{ notebook.record_count || 0 }} 条记录</small></button><button type="button" :disabled="!expanded.has(notebook.id)" @click="toggleAll(notebook)">{{ allSelected(notebook.id) ? '取消全选' : '全选' }}</button></div><div v-if="loadingRecords.has(notebook.id)" class="picker-loading compact"><span class="mastery-spinner" /></div><div v-else-if="expanded.has(notebook.id)" class="notebook-records"><button v-for="record in records[notebook.id] || []" :key="record.id" type="button" class="notebook-record-row" :class="{ selected: selectedIds.has(record.id) }" @click="toggleRecord(notebook, record)"><span class="history-check"><LegacyIcon v-if="selectedIds.has(record.id)" name="check" :size="12" /></span><span><strong>{{ record.title || '未命名记录' }}</strong><small>{{ record.summary || record.user_query || '无摘要' }}</small><em>{{ record.type }}</em></span></button></div></section></template></div>
  <footer><span>已选择 {{ selected.size }} 条记录</span><div><button type="button" @click="clear">清空</button><button type="button" class="primary" :disabled="!selected.size" @click="apply">使用所选记录（{{ selected.size }}）</button></div></footer>
</section></div></Teleport></template>
