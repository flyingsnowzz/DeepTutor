<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownView from './MarkdownView.vue'

export interface NotebookRecord {
  id: string
  type: string
  title: string
  summary?: string
  user_query?: string
  output?: string
  kb_name?: string | null
  created_at?: number
  metadata?: Record<string, unknown>
}
export interface NotebookTarget { id: string; name: string; color?: string; record_count?: number; unreadable?: boolean }
type Changes = { title?: string; summary?: string; output?: string }
type Done = (ok: boolean) => void
const props = withDefaults(defineProps<{ record: NotebookRecord; notebooks: NotebookTarget[]; currentNotebookId: string; expanded?: boolean; busy?: boolean }>(), { expanded: false, busy: false })
const emit = defineEmits<{
  toggle: []
  save: [recordId: string, changes: Changes, done: Done]
  relocate: [record: NotebookRecord, mode: 'move' | 'copy', targetId: string]
  remove: [record: NotebookRecord]
  openSession: [sessionId: string]
}>()
const root = ref<HTMLElement | null>(null)
const menu = ref<'' | 'root' | 'move' | 'copy'>('')
const editing = ref(false)
const previewing = ref(false)
const pending = ref<'' | 'delete' | 'discard'>('')
const draftTitle = ref(props.record.title)
const draftSummary = ref(props.record.summary || '')
const draftOutput = ref(props.record.output || '')
const failure = ref('')
const dirty = computed(() => draftTitle.value !== props.record.title || draftSummary.value !== (props.record.summary || '') || draftOutput.value !== (props.record.output || ''))
const targets = computed(() => props.notebooks.filter(item => item.id !== props.currentNotebookId && !item.unreadable))
const sessionId = computed(() => String(props.record.metadata?.session_id || ''))
const canOpenSession = computed(() => props.record.type === 'chat' && Boolean(sessionId.value))
const messageCount = computed(() => Number(props.record.metadata?.message_count || 0))
const badgeLabel = computed(() => ({ chat: '对话', tutorbot: String(props.record.metadata?.partner_name || '伙伴'), research: '研究', reading: '阅读', question: '问题', solve: '解答', co_writer: '学习笔记', video_learning: '视频学习' } as Record<string, string>)[props.record.type] || '收藏内容')
const kindIcon = computed(() => ({ chat: '▤', tutorbot: '◉', research: '⌕', reading: '▱', question: '?', solve: '∑', co_writer: '✎', video_learning: '▹' } as Record<string, string>)[props.record.type] || '▱')

function closeMenu() { menu.value = '' }
function startEditing() {
  if (!props.expanded) emit('toggle')
  draftTitle.value = props.record.title
  draftSummary.value = props.record.summary || ''
  draftOutput.value = props.record.output || ''
  failure.value = ''
  previewing.value = false
  editing.value = true
}
function leaveEditor() { editing.value = false; pending.value = ''; failure.value = '' }
function requestCancel() { if (dirty.value) pending.value = 'discard'; else leaveEditor() }
function save() {
  if (!draftTitle.value.trim()) { failure.value = '收藏内容需要标题。'; return }
  const changes: Changes = {}
  if (draftTitle.value !== props.record.title) changes.title = draftTitle.value.trim()
  if (draftSummary.value !== (props.record.summary || '')) changes.summary = draftSummary.value
  if (draftOutput.value !== (props.record.output || '')) changes.output = draftOutput.value
  if (!Object.keys(changes).length) { leaveEditor(); return }
  failure.value = ''
  emit('save', props.record.id, changes, ok => {
    if (ok) leaveEditor()
    else failure.value = '保存收藏内容失败，请重试。'
  })
}
function relocate(targetId: string) {
  const mode = menu.value === 'move' ? 'move' : 'copy'
  closeMenu()
  if (mode === 'move' || mode === 'copy') emit('relocate', props.record, mode, targetId)
}
function onDocumentPointerDown(event: PointerEvent) {
  if (root.value && event.target instanceof Node && !root.value.contains(event.target)) closeMenu()
}
function onDocumentKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') closeMenu() }
watch(() => props.record.id, () => { editing.value = false; pending.value = ''; closeMenu() })
onMounted(() => { document.addEventListener('pointerdown', onDocumentPointerDown); document.addEventListener('keydown', onDocumentKeyDown) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onDocumentPointerDown); document.removeEventListener('keydown', onDocumentKeyDown) })
</script>

<template>
  <article ref="root" class="dt-fav-record library-card" :class="{ 'is-open': expanded, 'is-busy': busy }" :data-record-id="record.id">
    <div class="dt-fav-record-head">
      <button type="button" class="dt-fav-record-toggle" :aria-expanded="expanded" @click="emit('toggle')">
        <span class="dt-fav-kind" :data-kind="record.type" aria-hidden="true">{{ kindIcon }}</span>
        <span class="dt-fav-record-title-wrap">
          <span class="dt-fav-record-title">{{ record.title }}</span>
          <span v-if="!expanded && record.summary" class="dt-fav-record-summary">{{ record.summary }}</span>
          <span class="dt-fav-record-meta">{{ badgeLabel }}<template v-if="messageCount"> · {{ messageCount }} 条消息</template><template v-if="record.created_at"> · <time :datetime="new Date(record.created_at * 1000).toISOString()">{{ new Date(record.created_at * 1000).toLocaleString() }}</time></template></span>
        </span>
      </button>
      <div class="dt-fav-record-tools">
        <button type="button" class="dt-fav-icon-button" aria-label="编辑收藏详情" title="编辑收藏详情" :disabled="busy" @click="startEditing">✎</button>
        <div class="notebook-record-actions">
          <button type="button" class="dt-fav-icon-button" aria-label="收藏操作" aria-haspopup="menu" :aria-expanded="Boolean(menu)" :disabled="busy" @click="menu = menu ? '' : 'root'">•••</button>
          <div v-if="menu" class="notebook-record-menu" role="menu" aria-label="收藏操作">
            <template v-if="menu === 'root'">
              <button type="button" role="menuitem" @click="closeMenu(); startEditing()">✎ 编辑收藏详情</button>
              <button v-if="targets.length" type="button" role="menuitem" @click="menu = 'move'">↗ 移动到 <span>›</span></button>
              <button v-if="targets.length" type="button" role="menuitem" @click="menu = 'copy'">⧉ 复制到 <span>›</span></button>
              <div class="notebook-record-menu-divider" />
              <button type="button" role="menuitem" class="legacy-danger" @click="closeMenu(); pending = 'delete'">⌫ 删除</button>
            </template>
            <template v-else>
              <button type="button" class="notebook-record-menu-back" @click="menu = 'root'">← {{ menu === 'move' ? '移动到' : '复制到' }}</button>
              <div class="notebook-record-targets"><button v-for="target in targets" :key="target.id" type="button" role="menuitem" @click="relocate(target.id)"><i :style="{ backgroundColor: target.color || '#6366F1' }" /><span>{{ target.name }}</span><small>{{ target.record_count || 0 }}</small></button></div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-if="expanded || editing" class="dt-fav-record-body">
      <p v-if="failure" class="dt-fav-record-error" role="alert">{{ failure }}</p>
      <template v-if="editing">
        <div class="notebook-record-editor">
          <div class="notebook-record-editor-actions"><button type="button" :aria-pressed="previewing" @click="previewing = !previewing">{{ previewing ? '继续编辑' : '预览' }}</button><button type="button" class="primary" :disabled="busy || !draftTitle.trim()" @click="save">保存</button><button type="button" :disabled="busy" @click="requestCancel">取消</button></div>
          <template v-if="previewing"><h3>{{ draftTitle }}</h3><p v-if="draftSummary">{{ draftSummary }}</p><MarkdownView :content="draftOutput" /></template>
          <template v-else><input v-model="draftTitle" aria-label="收藏标题" placeholder="标题"><textarea v-model="draftSummary" aria-label="收藏摘要" rows="3" placeholder="摘要（可选）" /><textarea v-model="draftOutput" aria-label="收藏内容" rows="12" placeholder="内容" /></template>
        </div>
      </template>
      <template v-else>
        <p v-if="record.summary" class="dt-fav-record-lead">{{ record.summary }}</p>
        <p v-if="record.type !== 'chat' && record.user_query" class="dt-fav-record-query"><span>问题：</span>{{ record.user_query }}</p>
        <div class="dt-fav-record-content"><MarkdownView :content="record.output || ''" /></div>
        <div class="dt-fav-record-actions"><button v-if="canOpenSession" type="button" class="dt-fav-button" @click="emit('openSession', sessionId)">↗ 打开聊天会话</button></div>
      </template>
    </div>

    <Teleport to="body"><div v-if="pending" class="notebook-record-confirm-overlay" @click.self="pending = ''"><section class="notebook-record-confirm" role="alertdialog" aria-modal="true" :aria-label="pending === 'delete' ? '删除这条收藏？' : '放弃未保存的修改？'"><h2>{{ pending === 'delete' ? '删除这条收藏？' : '放弃未保存的修改？' }}</h2><p>{{ pending === 'delete' ? `“${record.title}”将从这个收藏夹移除。` : '这条收藏的修改尚未保存。' }}</p><footer><button type="button" @click="pending = ''">取消</button><button v-if="pending === 'delete'" type="button" class="primary" :disabled="busy" @click="pending = ''; emit('remove', record)">删除</button><button v-else type="button" class="primary" @click="leaveEditor">放弃修改</button></footer></section></div></Teleport>
  </article>
</template>
