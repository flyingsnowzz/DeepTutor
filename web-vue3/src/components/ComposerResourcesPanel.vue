<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { api } from '../api'

interface KnowledgeOption { id: string; name: string; metadata?: { type?: string; agent_kind?: string } }
interface TaskCard { id: string; title: string; note?: string; status: string; archived?: boolean }
interface SessionTaskLink { workspace_id: string; session_id: string; task_ids: string[]; status_link_enabled: boolean }
interface TaskBoard { cards?: TaskCard[]; colors?: Record<string, string>; session_links?: SessionTaskLink[] }
type ResourceKey = 'attach' | 'history' | 'agents' | 'books' | 'reading' | 'notebooks' | 'questions' | 'tasks' | 'knowledge'

const props = withDefaults(defineProps<{
  sessionId?: string | null
  workspaceId?: string
  anchorLeft?: number
  anchorBottom?: number
  draftTaskIds?: string[]
  knowledgeBases: KnowledgeOption[]
  selectedKbs: Set<string>
  counts: { history: number; agents: number; books: number; reading: number; notebooks: number; questions: number }
}>(), { sessionId: null, workspaceId: '', draftTaskIds: () => [], anchorLeft: 12, anchorBottom: 12 })
const emit = defineEmits<{
  close: []
  attach: []
  history: []
  agents: []
  books: []
  reading: []
  notebooks: []
  questions: []
  'update:draftTaskIds': [ids: string[]]
  'update:selectedKbs': [ids: Set<string>]
}>()

const selectedKey = ref<ResourceKey | ''>('')
const query = ref('')
const taskQuery = ref('')
const board = ref<TaskBoard | null>(null)
const tasksLoading = ref(false)
const tasksError = ref('')
const items = computed(() => [
  { key: 'attach' as const, label: '上传附件', icon: 'attachment', count: 0, summary: '', direct: true },
  { key: 'history' as const, label: '聊天历史', icon: 'history', count: props.counts.history, summary: '', direct: false },
  { key: 'agents' as const, label: '智能体历史对话', icon: 'agents', count: props.counts.agents, summary: '', direct: false },
  { key: 'books' as const, label: '书籍', icon: 'book', count: props.counts.books, summary: '', direct: false },
  { key: 'reading' as const, label: '阅读', icon: 'reading', count: props.counts.reading, summary: '', direct: false },
  { key: 'notebooks' as const, label: '收藏夹', icon: 'bookmark', count: props.counts.notebooks, summary: '', direct: false },
  { key: 'questions' as const, label: '题库', icon: 'questions', count: props.counts.questions, summary: '', direct: false },
  { key: 'tasks' as const, label: '关联任务', icon: 'tasks', count: linkedTaskIds.value.length, summary: linkedTaskIds.value.length ? `${linkedTaskIds.value.length} 已选择` : '默认', direct: false },
  { key: 'knowledge' as const, label: '知识库', icon: 'knowledge', count: props.selectedKbs.size, summary: props.selectedKbs.size ? `${props.selectedKbs.size} 已选择` : props.knowledgeBases.length ? '默认' : '无知识库', direct: false },
])
const filteredItems = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return keyword ? items.value.filter(item => item.label.toLocaleLowerCase().includes(keyword)) : items.value
})
const filteredMaterials = computed(() => filteredItems.value.filter(item => item.key !== 'tasks' && item.key !== 'knowledge'))
const filteredLinkedItems = computed(() => filteredItems.value.filter(item => item.key === 'tasks' || item.key === 'knowledge'))
const linkedTaskIds = computed(() => {
  if (!props.sessionId) return props.draftTaskIds || []
  return board.value?.session_links?.find(link => link.session_id === props.sessionId && link.workspace_id === (props.workspaceId || ''))?.task_ids || []
})
const taskCards = computed(() => {
  const keyword = taskQuery.value.trim().toLocaleLowerCase()
  return (board.value?.cards || []).filter(card => (!card.archived || linkedTaskIds.value.includes(card.id)) && `${card.title} ${card.note || ''}`.toLocaleLowerCase().includes(keyword))
})
const currentTitle = computed(() => items.value.find(item => item.key === selectedKey.value)?.label || '资源')
const knowledgeRows = computed(() => props.knowledgeBases.filter(kb => kb.metadata?.type !== 'subagent'))

async function loadTasks() {
  if (board.value || tasksLoading.value) return
  tasksLoading.value = true
  tasksError.value = ''
  try { board.value = await api<TaskBoard>('/api/task-board') }
  catch { tasksError.value = '任务暂时无法加载。' }
  finally { tasksLoading.value = false }
}
async function toggleTask(id: string) {
  const current = linkedTaskIds.value
  const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id]
  if (!props.sessionId) {
    emit('update:draftTaskIds', next)
    return
  }
  try {
    board.value = await api<TaskBoard>(`/api/task-board/sessions/${encodeURIComponent(props.sessionId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: props.workspaceId || '', task_ids: next }),
    })
  } catch { tasksError.value = '任务关联保存失败。' }
}
function toggleKnowledge(id: string) {
  const next = new Set(props.selectedKbs)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('update:selectedKbs', next)
}
function selectItem(item: typeof items.value[number]) {
  if (item.direct) {
    emit('attach')
    emit('close')
    return
  }
  selectedKey.value = item.key
  if (item.key === 'tasks') void loadTasks()
  if (item.key === 'knowledge' || item.key === 'tasks') return
  if (item.key === 'history') emit('history')
  else if (item.key === 'agents') emit('agents')
  else if (item.key === 'books') emit('books')
  else if (item.key === 'reading') emit('reading')
  else if (item.key === 'notebooks') emit('notebooks')
  else if (item.key === 'questions') emit('questions')
  emit('close')
}
function close() { emit('close') }
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  if (selectedKey.value) selectedKey.value = ''
  else close()
}
watch(() => props.sessionId, () => { board.value = null })
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template>
  <Teleport to="body">
    <div class="composer-resources-surface" @click.self="close">
      <section class="composer-resources-panel" role="dialog" aria-modal="true" aria-label="资源" :style="{ left: `${anchorLeft}px`, bottom: `${anchorBottom}px` }" @click.stop @keydown.stop>
        <header>
          <button v-if="selectedKey" type="button" aria-label="返回" @click="selectedKey = ''"><LegacyIcon name="chevronLeft" :size="16" /></button>
          <strong>{{ currentTitle }}</strong>
          <button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="16" /></button>
        </header>
        <template v-if="!selectedKey">
          <label class="composer-resource-search"><LegacyIcon name="search" :size="15" /><input v-model="query" aria-label="搜索资源入口" placeholder="搜索资源入口" autofocus /></label>
          <div class="composer-resource-section-label">参考资料</div>
          <div class="composer-resource-entries">
            <button v-for="item in filteredMaterials" :key="item.key" type="button" :class="{ 'is-wide': item.key === 'attach', selected: item.count > 0 }" @click="selectItem(item)">
              <LegacyIcon :name="item.icon" :size="15" />
              <span>{{ item.label }}</span>
              <em v-if="item.summary">{{ item.summary }}</em>
              <LegacyIcon v-if="!item.direct" name="chevronRight" :size="14" />
            </button>
          </div>
          <div class="composer-resource-linked-entries"><button v-for="item in filteredLinkedItems" :key="item.key" type="button" :class="{ selected: item.count > 0 }" @click="selectItem(item)"><LegacyIcon :name="item.icon" :size="15" /><span>{{ item.label }}</span><em v-if="item.summary">{{ item.summary }}</em><LegacyIcon name="chevronRight" :size="14" /></button></div>
        </template>
        <div v-else-if="selectedKey === 'knowledge'" class="composer-resource-subview">
          <p v-if="!knowledgeRows.length" class="composer-resource-empty">没有可用知识库。</p>
          <label v-for="kb in knowledgeRows" :key="kb.id || kb.name" class="composer-resource-check"><input type="checkbox" :checked="selectedKbs.has(kb.id || kb.name)" @change="toggleKnowledge(kb.id || kb.name)" /><span>{{ kb.name }}</span></label>
        </div>
        <div v-else-if="selectedKey === 'tasks'" class="composer-resource-subview">
          <input v-model="taskQuery" class="composer-task-search" aria-label="搜索任务" placeholder="搜索任务" />
          <p v-if="tasksLoading" class="composer-resource-empty">正在加载任务…</p>
          <p v-else-if="tasksError" class="composer-resource-empty" role="alert">{{ tasksError }}</p>
          <p v-else-if="!taskCards.length" class="composer-resource-empty">没有可关联的任务。</p>
          <label v-for="card in taskCards" v-else :key="card.id" class="composer-resource-task"><input type="checkbox" :checked="linkedTaskIds.includes(card.id)" @change="toggleTask(card.id)" /><i :style="{ background: board?.colors?.[card.status] || '#2563eb' }" /><span>{{ card.title }}<small>{{ card.status }}</small></span></label>
        </div>
      </section>
    </div>
  </Teleport>
</template>
