<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, post } from '../api'
import TaskColorPicker, { type TaskColors } from '../components/TaskColorPicker.vue'
import LegacyIcon from '../components/LegacyIcon.vue'

type Status = 'todo' | 'doing' | 'done'
type Task = { id: string; title: string; note: string; status: Status; due_date?: string | null; archived: boolean; created_at?: string; updated_at?: string }
type Colors = Record<Status, string>
type Board = { cards: Task[]; revision: number; colors?: Colors; session_links?: unknown[] }
const DEFAULT_COLORS: Colors = { todo: '#2563eb', doing: '#a16207', done: '#15803d' }
const board = ref<Board | null>(null)
const blocks = ref<Record<string, number>>({})
const title = ref('')
const editing = ref('')
const draftTitle = ref('')
const draftNote = ref('')
const dueDate = ref('')
const dateFilter = ref<'all' | 'today' | 'week'>('all')
const showArchived = ref(false)
const error = ref('')
const busy = ref(false)
const dragged = ref('')
const dropTarget = ref<Status | ''>('')
const kanbanMenuOpen = ref(false)
const colors = ref<Colors>({ ...DEFAULT_COLORS })
const columns: { status: Status; label: string; hint: string; icon: string }[] = [
  { status: 'todo', label: '待办', hint: '下一步与想法', icon: 'circleDashed' }, { status: 'doing', label: '进行中', hint: '正在处理的事', icon: 'circleDot' }, { status: 'done', label: '已完成', hint: '完成的工作', icon: 'circleCheck' },
]
const active = computed(() => board.value?.cards.filter(card => !card.archived) || [])
const today = dayKey(new Date())
const visible = computed(() => (board.value?.cards || []).filter(card => {
  if (card.archived !== showArchived.value) return false
  if (dateFilter.value === 'all') return true
  if (!card.due_date) return false
  if (dateFilter.value === 'today') return card.due_date === today
  const start = new Date()
  const weekday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - weekday)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return card.due_date >= dayKey(start) && card.due_date < dayKey(end)
}))
function dayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function count(status: Status) { return visible.value.filter(card => card.status === status).length }
async function load() {
  error.value = ''
  try {
    board.value = await api<Board>('/api/task-board')
    colors.value = { ...DEFAULT_COLORS, ...(board.value.colors || {}) }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载任务失败' }
  try { blocks.value = await api<Record<string, number>>('/api/calendar/task-blocks') }
  catch { blocks.value = {} }
}
onMounted(() => { void load() })
async function act(operation: () => Promise<Board>) {
  if (busy.value) return false
  busy.value = true
  error.value = ''
  try {
    board.value = await operation()
    colors.value = { ...DEFAULT_COLORS, ...(board.value.colors || {}) }
    return true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存任务失败'; return false }
  finally { busy.value = false }
}
async function create() {
  if (!title.value.trim()) return
  if (await act(() => post<Board>('/api/task-board/cards', { title: title.value.trim() }))) { title.value = ''; showArchived.value = false }
}
async function change(card: Task, patch: Partial<Task>) { await act(() => api<Board>(`/api/task-board/cards/${encodeURIComponent(card.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })) }
function startEdit(card: Task) { editing.value = card.id; draftTitle.value = card.title; draftNote.value = card.note || ''; dueDate.value = card.due_date || '' }
async function saveEdit(card: Task) {
  if (!draftTitle.value.trim()) return
  if (await act(() => api<Board>(`/api/task-board/cards/${encodeURIComponent(card.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: draftTitle.value.trim(), note: draftNote.value, due_date: dueDate.value || null }) }))) editing.value = ''
}
function drop(status: Status) {
  if (!dragged.value || showArchived.value) return
  const card = board.value?.cards.find(item => item.id === dragged.value)
  dragged.value = ''
  dropTarget.value = ''
  if (card && card.status !== status) void change(card, { status })
}
function move(card: Task, status: Status) { void change(card, { status }) }
async function saveColors(nextColors: TaskColors, done: () => void) {
  if (await act(() => api<Board>('/api/task-board/colors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nextColors) }))) done()
}
</script>

<template>
  <main class="feature-page kanban-page">
    <nav class="kanban-page-bar" aria-label="位置"><div class="kanban-crumb-wrap"><button type="button" class="kanban-crumb" aria-haspopup="menu" :aria-expanded="kanbanMenuOpen" @click.stop="kanbanMenuOpen = !kanbanMenuOpen" @keydown.esc="kanbanMenuOpen = false"><LegacyIcon name="columns" :size="15" />任务看板</button><span class="kanban-working-count">{{ active.filter(card => card.status === 'doing').length }} 项进行中</span><template v-if="kanbanMenuOpen"><div class="kanban-menu-dismiss" @click="kanbanMenuOpen = false"></div><div class="kanban-resource-menu" role="menu" aria-label="主页"><p>主页</p><RouterLink role="menuitem" to="/chat" @click="kanbanMenuOpen = false">聊天</RouterLink><RouterLink role="menuitem" to="/calendar" @click="kanbanMenuOpen = false">日历</RouterLink><RouterLink role="menuitem" class="is-active" to="/kanban" @click="kanbanMenuOpen = false">任务看板</RouterLink><RouterLink role="menuitem" to="/co-writer" @click="kanbanMenuOpen = false">笔记本</RouterLink></div></template></div><div class="kanban-bar-actions"><TaskColorPicker :colors="colors" :busy="busy" :disabled="!board" :error="error" @save="saveColors" /><button type="button" class="kanban-archive-toggle" :aria-pressed="showArchived" :disabled="busy" @click="showArchived = !showArchived; editing = ''"><LegacyIcon name="archive" :size="15" :stroke-width="1.7" />{{ showArchived ? '显示未归档' : '显示已归档' }}</button></div></nav>
    <div class="kanban-page-content"><header class="feature-heading"><div class="kanban-title-line"><h1>任务看板</h1><span>{{ active.filter(card => card.status === 'doing').length }} 项进行中</span></div><p>让任务从想法逐步走向完成。</p></header><div class="kanban-preferences"><TaskColorPicker :colors="colors" :busy="busy" :disabled="!board" :error="error" @save="saveColors" /><button type="button" class="kanban-archive-toggle" :aria-pressed="showArchived" :disabled="busy" @click="showArchived = !showArchived; editing = ''"><LegacyIcon name="archive" :size="15" :stroke-width="1.7" />{{ showArchived ? '显示未归档' : '显示已归档' }}</button></div>
    <div class="kanban-toolbar"><select v-model="dateFilter" aria-label="按日期筛选"><option value="all">所有日期</option><option value="today">今天</option><option value="week">本周</option></select><RouterLink to="/calendar">打开日历</RouterLink></div>
    <form class="task-create" @submit.prevent="create"><input v-model="title" maxlength="160" aria-label="新任务" placeholder="添加任务…" :disabled="!board || busy"><button class="primary" :disabled="busy || !board || !title.trim()"><LegacyIcon name="plus" :size="15" :stroke-width="1.8" />添加</button></form>
    <p v-if="error" class="error" role="alert">{{ error }} <button v-if="!board" @click="load">重试</button></p><p v-if="!board && !error" role="status">加载中…</p>
    <div class="task-columns" :aria-busy="busy">
      <section
        v-for="(column, columnIndex) in columns"
        :key="column.status"
        class="task-column"
        :aria-label="column.label"
        :class="{ 'drop-target': dropTarget === column.status }"
        @dragover.prevent="!showArchived && (dropTarget = column.status)"
        @dragleave="dropTarget = ''"
        @drop.prevent="drop(column.status)"
      >
        <header class="task-column-head">
          <span class="task-column-dot" :style="{ backgroundColor: colors[column.status] }" aria-hidden="true" />
          <div class="task-column-heading">
            <h2>{{ column.label }}</h2>
            <p class="muted">{{ column.hint }}</p>
          </div>
          <span class="task-column-count">{{ count(column.status) }}</span>
        </header>
        <div class="task-card-list">
          <article
            v-for="card in visible.filter(item => item.status === column.status)"
            :key="card.id"
            class="task-card"
            :draggable="!showArchived && !busy && editing !== card.id"
            @dragstart="dragged = card.id"
            @dragend="dragged = ''; dropTarget = ''"
          >
            <form v-if="editing === card.id" class="settings-form" @submit.prevent="saveEdit(card)">
              <input v-model="draftTitle" aria-label="任务标题" maxlength="160" required>
              <textarea v-model="draftNote" aria-label="任务备注" rows="3" maxlength="2000" />
              <label>截止日期<input v-model="dueDate" type="date" aria-label="截止日期"></label>
              <div class="partner-actions">
                <button class="primary" :disabled="busy || !draftTitle.trim()">保存</button>
                <button type="button" @click="editing = ''">取消</button>
              </div>
            </form>
            <template v-else>
              <button type="button" class="task-card-open" :aria-label="card.title" :disabled="busy" @click="startEdit(card)">
                <strong>{{ card.title }}</strong>
                <small v-if="card.due_date" class="task-due" :class="{ overdue: card.status !== 'done' && card.due_date < today, dueToday: card.due_date === today }">截止 {{ card.due_date }}</small><small v-if="blocks[card.id] > 0" class="task-blocks">已排 {{ blocks[card.id] }} 段</small>
                <p v-if="card.note">{{ card.note }}</p>
              </button>
              <div class="task-card-actions">
                <button
                  v-if="!showArchived && columnIndex > 0"
                  type="button"
                  :title="`移回 ${columns[columnIndex - 1].label}`"
                  :aria-label="`${card.title}: 移至 ${columns[columnIndex - 1].label}`"
                  :disabled="busy"
                  @click="move(card, columns[columnIndex - 1].status)"
                ><LegacyIcon name="arrowLeft" :size="16" /></button>
                <button
                  v-if="!showArchived && columnIndex < columns.length - 1"
                  type="button"
                  :title="`向前移动 ${columns[columnIndex + 1].label}`"
                  :aria-label="`${card.title}: 移至 ${columns[columnIndex + 1].label}`"
                  :disabled="busy"
                  @click="move(card, columns[columnIndex + 1].status)"
                ><LegacyIcon name="arrowRight" :size="16" /></button>
                <button
                  type="button"
                  :title="showArchived ? '恢复' : '归档'"
                  :aria-label="`${card.title}: ${showArchived ? '恢复' : '归档'}`"
                  :disabled="busy"
                  @click="change(card, { archived: !showArchived })"
                ><LegacyIcon :name="showArchived ? 'rotateCcw' : 'archive'" :size="15" /></button>
              </div>
            </template>
          </article>
          <div v-if="!count(column.status)" class="task-empty">
            <LegacyIcon :name="column.icon" :size="20" :stroke-width="1.3" />
            <p>{{ showArchived ? '没有已归档任务' : '将卡片拖到这里' }}</p>
          </div>
        </div>
      </section>
    </div>
    <footer class="kanban-footer">任务保存在独立看板中，可分配到工作区，或关联到对话。</footer>
    </div>
  </main>
</template>
