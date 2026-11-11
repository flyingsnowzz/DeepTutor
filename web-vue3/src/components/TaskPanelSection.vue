<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'

type TaskStatus = 'todo' | 'doing' | 'done'
type TaskCard = { id: string; title: string; note?: string; status: TaskStatus | string; archived?: boolean }
type TaskLink = { workspace_id: string; session_id: string; task_ids: string[]; status_link_enabled: boolean }
type TaskBoard = { cards?: TaskCard[]; colors?: Record<string, string>; session_links?: TaskLink[]; revision?: number }

const props = withDefaults(defineProps<{
  board: TaskBoard | null
  sessionId: string | null
  workspaceId: string
  draftTaskIds?: string[]
}>(), { draftTaskIds: () => [] })
const emit = defineEmits<{
  'update:board': [value: TaskBoard]
  'update:draft-task-ids': [value: string[]]
}>()

const busy = ref(false)
const error = ref(false)
const statusLabels: Record<string, string> = { todo: '待办', doing: '进行中', done: '已完成' }
const cards = computed(() => props.board?.cards || [])
const ids = computed(() => {
  if (!props.sessionId) return props.draftTaskIds
  const link = props.board?.session_links?.find(item => item.session_id === props.sessionId && item.workspace_id === props.workspaceId)
  return link?.task_ids || []
})
const linked = computed(() => [...ids.value].reverse().flatMap(id => {
  const card = cards.value.find(item => item.id === id)
  return card ? [card] : []
}))
const assigned = computed(() => cards.value.filter(card => !card.archived && !ids.value.includes(card.id)))
const visible = computed(() => linked.value.length > 0 || assigned.value.length > 0)

async function save(operation: () => Promise<TaskBoard>) {
  busy.value = true
  error.value = false
  try {
    emit('update:board', await operation())
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}
function unlink(card: TaskCard) {
  const next = ids.value.filter(id => id !== card.id)
  if (!props.sessionId) {
    emit('update:draft-task-ids', next)
    return
  }
  void save(() => api<TaskBoard>(`/api/task-board/sessions/${encodeURIComponent(props.sessionId || '')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: props.workspaceId, task_ids: next }),
  }))
}
function updateStatus(card: TaskCard, status: string) {
  void save(() => api<TaskBoard>(`/api/task-board/cards/${encodeURIComponent(card.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }))
}
</script>

<template>
  <section v-if="visible" class="dt-viewer-task-panel" aria-label="关联任务">
    <p v-if="error" role="alert">任务保存失败。</p>
    <div v-if="linked.length" class="dt-viewer-task-group">
      <h3>关联任务</h3>
      <div v-for="card in linked" :key="card.id" class="dt-viewer-task-card">
        <div><i :style="{ backgroundColor: board?.colors?.[card.status] || '#2563eb' }" /><strong>{{ card.title }}</strong><button type="button" :disabled="busy" :aria-label="`${card.title}: 取消关联`" @click="unlink(card)"><LegacyIcon name="close" :size="14" /></button></div>
        <p v-if="card.note">{{ card.note }}</p>
        <select :value="card.status" :disabled="busy" :aria-label="`${card.title}: 状态`" @change="updateStatus(card, ($event.target as HTMLSelectElement).value)"><option v-for="status in (['todo', 'doing', 'done'] as const)" :key="status" :value="status">{{ statusLabels[status] }}</option></select>
        <span v-if="card.archived">已归档</span>
      </div>
    </div>
    <div v-if="assigned.length" class="dt-viewer-task-group">
      <h3>工作区任务</h3>
      <div v-for="card in assigned" :key="card.id" class="dt-viewer-task-card">
        <div><i :style="{ backgroundColor: board?.colors?.[card.status] || '#2563eb' }" /><strong>{{ card.title }}</strong></div>
        <p v-if="card.note">{{ card.note }}</p>
        <select :value="card.status" :disabled="busy" :aria-label="`${card.title}: 状态`" @change="updateStatus(card, ($event.target as HTMLSelectElement).value)"><option v-for="status in (['todo', 'doing', 'done'] as const)" :key="status" :value="status">{{ statusLabels[status] }}</option></select>
      </div>
    </div>
    <RouterLink to="/kanban">打开任务看板</RouterLink>
  </section>
</template>
