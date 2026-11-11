<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { api, post } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import { scopedUrl } from '../workspaceScope'

export interface ConversationMessage { role: string; content: string }
interface Notebook { id: string; name: string; description?: string; color?: string; record_count?: number; unreadable?: boolean }
const props = withDefaults(defineProps<{ messages: ConversationMessage[]; sessionId?: string; capability?: string; recordType?: string; metadata?: Record<string, unknown>; fallbackTitle?: string }>(), { sessionId: '', capability: 'chat', recordType: 'chat', metadata: () => ({}), fallbackTitle: '聊天对话' })
const emit = defineEmits<{ close: []; saved: [] }>()
const notebooks = ref<Notebook[]>([])
const selectedNotebookIds = ref<string[]>([])
const selectedIndexes = ref<Set<number>>(new Set(props.messages.map((_, index) => index)))
const newNotebookName = ref('')
const title = ref(props.messages.find(message => message.role === 'user')?.content.trim().slice(0, 80) || props.fallbackTitle)
const summaryPreview = ref('')
const titleEdited = ref(false)
const busy = ref(false)
const creating = ref(false)
const error = ref('')
const overlay = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape' && !busy.value) { event.preventDefault(); emit('close') } }

const orderedMessages = computed(() => [...selectedIndexes.value].sort((a, b) => a - b).map(index => props.messages[index]).filter(Boolean))
const output = computed(() => orderedMessages.value.map(message => `## ${message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System'}\n${message.content}`).join('\n\n'))
const userQuery = computed(() => orderedMessages.value.filter(message => message.role === 'user').map(message => message.content).join('\n\n'))
const canSave = computed(() => Boolean(title.value.trim() && selectedNotebookIds.value.length && output.value.trim() && orderedMessages.value.length && !busy.value))

function toggleNotebook(id: string) {
  selectedNotebookIds.value = selectedNotebookIds.value.includes(id) ? selectedNotebookIds.value.filter(item => item !== id) : [...selectedNotebookIds.value, id]
}
function toggleMessage(index: number) {
  const next = new Set(selectedIndexes.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  selectedIndexes.value = next
  if (!titleEdited.value) title.value = orderedMessages.value.find(message => message.role === 'user')?.content.trim().slice(0, 80) || props.fallbackTitle
}
function selectLastTurns(count: number) {
  const userPositions = props.messages.map((message, index) => message.role === 'user' ? index : -1).filter(index => index >= 0)
  const start = userPositions[Math.max(0, userPositions.length - count)] ?? 0
  selectedIndexes.value = new Set(props.messages.map((_, index) => index).filter(index => index >= start))
}
async function createNotebook() {
  const name = newNotebookName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  error.value = ''
  try {
    const result = await post<{ notebook?: Notebook } & Notebook>('/api/notebooks', { name, description: '' })
    const created = result.notebook || result
    notebooks.value = [created, ...notebooks.value]
    selectedNotebookIds.value = [created.id]
    newNotebookName.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建收藏夹失败' }
  finally { creating.value = false }
}
async function save() {
  if (!canSave.value) return
  busy.value = true
  error.value = ''
  try {
    summaryPreview.value = ''
    const response = await fetch(scopedUrl('/api/notebooks/actions/add-record-with-summary'), {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebook_ids: selectedNotebookIds.value,
        record_type: props.recordType, title: title.value.trim(), user_query: userQuery.value, output: output.value,
        metadata: {
          ...props.metadata,
          source: props.metadata.source || (props.capability === 'mastery_path' ? 'mastery_path' : 'chat'), capability: props.capability || 'chat', ui_language: 'zh-CN', session_id: props.sessionId,
          message_count: orderedMessages.value.length, total_message_count: props.messages.length,
          selected_message_indexes: [...selectedIndexes.value].sort((a, b) => a - b),
        },
      }),
    })
    if (!response.ok) throw new Error(`保存失败（HTTP ${response.status}）`)
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          for (const line of block.split('\n')) {
            if (!line.trim().startsWith('data:')) continue
            try {
              const payload = JSON.parse(line.trim().slice(5).trim()) as Record<string, unknown>
              if (payload.type === 'summary_chunk') summaryPreview.value += String(payload.content || '')
              else if (payload.type === 'result' || payload.type === 'error') summaryPreview.value = String(payload.summary || payload.detail || payload.content || summaryPreview.value)
            } catch { /* keep non-JSON heartbeat lines out of the UI */ }
          }
        }
      }
    } else {
      await response.text()
    }
    emit('saved')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.addEventListener('keydown', closeOnEscape)
  await nextTick()
  overlay.value?.focus()
  try { notebooks.value = (await api<{ notebooks: Notebook[] }>('/api/notebooks')).notebooks.filter(item => !item.unreadable) }
  catch { notebooks.value = [] }
})
onUnmounted(() => { document.removeEventListener('keydown', closeOnEscape); previousFocus?.focus() })
</script>

<template>
  <div ref="overlay" class="conversation-save-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="保存到收藏夹" @click.self="!busy && emit('close')" @keydown.esc="!busy && emit('close')">
    <section class="conversation-save-dialog">
      <header><div class="conversation-save-heading"><LegacyIcon name="notebookPen" :size="18" /><div><h2>保存到收藏夹</h2><p>选择要包含的消息，选择一个或多个收藏夹，摘要会自动生成。</p></div></div><button type="button" aria-label="关闭" :disabled="busy" @click="emit('close')">×</button></header>
      <div class="conversation-save-body">
        <label class="conversation-save-title">标题<input v-model="title" maxlength="200" @input="titleEdited = true"></label>
        <section class="conversation-save-section">
          <div class="conversation-save-section-head"><h3>选择消息 <small>{{ orderedMessages.length }} / {{ messages.length }}</small></h3><div><button type="button" @click="selectedIndexes = new Set(messages.map((_, index) => index))">全选</button><button type="button" @click="selectedIndexes = new Set()">清空</button><button type="button" @click="selectLastTurns(1)">最近一轮</button><button type="button" @click="selectLastTurns(3)">最近三轮</button></div></div>
          <div class="conversation-save-messages">
            <label v-for="(message, index) in messages" :key="index" class="conversation-save-message"><input type="checkbox" :checked="selectedIndexes.has(index)" @change="toggleMessage(index)"><span><strong>{{ message.role === 'user' ? '你' : message.role === 'assistant' ? 'DeepTutor' : '系统' }}</strong><p>{{ message.content }}</p></span></label>
          </div>
        </section>
        <section class="conversation-save-section">
          <h3>保存到</h3>
          <div class="conversation-save-notebooks"><label v-for="notebook in notebooks" :key="notebook.id"><input type="checkbox" :checked="selectedNotebookIds.includes(notebook.id)" @change="toggleNotebook(notebook.id)"><span><strong>{{ notebook.name }}</strong><small v-if="notebook.record_count !== undefined">{{ notebook.record_count }} 条记录</small><small v-if="notebook.description">{{ notebook.description }}</small></span></label><p v-if="!notebooks.length" class="muted">还没有可用收藏夹，可在下方新建。</p></div>
          <form class="conversation-save-new" @submit.prevent="createNotebook"><input v-model="newNotebookName" aria-label="新收藏夹名称" placeholder="新建收藏夹…" :disabled="creating"><button type="submit" :disabled="creating || !newNotebookName.trim()">＋ 新建</button></form>
        </section>
        <section class="conversation-save-section"><h3>摘要预览</h3><div class="conversation-save-summary">{{ summaryPreview || '保存过程中生成的摘要会显示在这里。' }}</div></section>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </div>
      <footer><button type="button" :disabled="busy" @click="emit('close')">取消</button><button type="button" class="primary" :disabled="!canSave" @click="save">{{ busy ? '保存中…' : '保存到收藏夹' }}</button></footer>
    </section>
  </div>
</template>
