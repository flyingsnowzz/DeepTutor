<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import TaskPanelSection from './TaskPanelSection.vue'
import SideChatPanel from './SideChatPanel.vue'
import ConsultationTabBody from './ConsultationTabBody.vue'
import { DITO, responderFromPreferences, sideChatKey, type SideChatContext, type SideChatResponder } from '../sideChat'
import { api } from '../api'
import type { SubagentEvent } from '../subagentTrace'

type ViewerAttachment = {
  id?: string
  type: string
  filename?: string
  base64?: string
  mime_type?: string
  url?: string
  size_bytes?: number
  extracted_text?: string
  previewUrl?: string
}
type ViewerEvent = { type: string; content?: string; message?: string; status?: string }
type ViewerMessage = { id?: number; events?: ViewerEvent[] }
type TaskCard = { id: string; title: string; note?: string; status: string; archived?: boolean }
type TaskLink = { workspace_id: string; session_id: string; task_ids: string[]; status_link_enabled: boolean }
type TaskBoard = { cards?: TaskCard[]; colors?: Record<string, string>; session_links?: TaskLink[]; revision?: number }
type ViewerTab = {
  id: string
  kind: 'note' | 'file' | 'web' | 'side-chat' | 'subagent'
  label: string
  attachment?: ViewerAttachment
  url?: string
  objectUrl?: string
  sideChat?: SideChatContext
  seedQuote?: { id: number; text: string } | null
  followupSessionId?: string | null
  subagentEvents?: SubagentEvent[]
}
type SideChatOption = {
  responder?: SideChatResponder
  quote?: string
  seedId?: number
  sessionId?: string
  parentTitle?: string
}
type SideThread = {
  session_id: string
  title?: string
  preferences?: Record<string, unknown>
}

const props = withDefaults(defineProps<{
  open: boolean
  note: string
  sessionId?: string
  sessionTitle?: string
  workspaceId?: string
  taskBoard?: TaskBoard | null
  taskDraftIds?: string[]
  attachments?: ViewerAttachment[]
  messages?: ViewerMessage[]
  streamEvents?: ViewerEvent[]
  attachmentHref: (attachment: ViewerAttachment) => string
  agents?: Array<{ name: string; kind?: string }>
  partners?: Array<{ partner_id: string; name: string; emoji?: string; color?: string; avatar?: string; description?: string }>
  groups?: Array<{ group_id: string; name: string; emoji?: string; description?: string }>
  language?: string | null
  llmOptions?: Array<{ profile_id: string; model_id: string; profile_name?: string; model_name?: string }>
  initialModel?: string
  knowledgeBases?: Array<{ name: string; metadata?: { type?: string } }>
  skills?: Array<{ id: string; name: string }>
  mcp?: Array<{ id: string; name: string }>
  personas?: Array<{ id: string; name: string }>
}>(), { attachments: () => [], messages: () => [], streamEvents: () => [], workspaceId: '', sessionTitle: '', taskBoard: null, taskDraftIds: () => [], agents: () => [], partners: () => [], groups: () => [], language: null, llmOptions: () => [], initialModel: '', knowledgeBases: () => [], skills: () => [], mcp: () => [], personas: () => [] })
const emit = defineEmits<{
  close: []
  'update:note': [value: string]
  'active-change': [value: 'activity' | 'attachments' | 'note' | 'side-chat']
  'update:task-board': [value: TaskBoard]
  'update:task-draft-ids': [value: string[]]
}>()

const WIDTH_KEY = 'dt:viewer-width'
const WIDTH_DEFAULT = 520
const WIDTH_MIN = 400
const WIDTH_MAX = 960
const NEW_TAB_ID = 'new'
const NOTE_TAB_ID = 'markdown-note'
const panelWidth = ref(WIDTH_DEFAULT)
const tabs = ref<ViewerTab[]>([])
const activeTabId = ref<string | null>(null)
const urlDraft = ref('')
const localFileInput = ref<HTMLInputElement | null>(null)
const resizing = ref(false)
const sideThreads = ref<SideThread[]>([])
const sideThreadsLoading = ref(false)
const subagentSeen = new Set<string>()
const tabStates = new Map<string, { tabs: ViewerTab[]; activeTabId: string | null }>()
let stopResize: (() => void) | null = null

const activeTab = computed(() => tabs.value.find(tab => tab.id === activeTabId.value) || null)
const launcherActive = computed(() => activeTabId.value === NEW_TAB_ID)
const sideThreadsForLauncher = computed(() => {
  const open = new Set(tabs.value.map(tab => tab.followupSessionId).filter(Boolean))
  return sideThreads.value.filter(thread => !open.has(thread.session_id))
})
const activityEvents = computed(() => [
  ...props.messages.flatMap(message => message.events || []),
  ...props.streamEvents,
])
const toolUses = computed(() => {
  const counts = new Map<string, number>()
  for (const event of activityEvents.value) {
    if (!/tool/i.test(event.type)) continue
    const name = event.type.replace(/^tool[._:-]?/i, '') || event.type
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count }))
})
const activityEmpty = computed(() => !activityEvents.value.length && !props.attachments.length)

function clampWidth(value: number) {
  const ceiling = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, window.innerWidth * 0.7))
  return Math.round(Math.max(WIDTH_MIN, Math.min(value, ceiling)))
}
function applyWidth(value: number) {
  panelWidth.value = clampWidth(value)
  document.documentElement.style.setProperty('--viewer-width', `${panelWidth.value}px`)
  localStorage.setItem(WIDTH_KEY, String(panelWidth.value))
}
function startResize(event: PointerEvent) {
  if (window.innerWidth < 768) return
  event.preventDefault()
  const startX = event.clientX
  const startWidth = panelWidth.value
  resizing.value = true
  document.documentElement.dataset.viewerResizing = 'true'
  const move = (next: PointerEvent) => applyWidth(startWidth + startX - next.clientX)
  const up = () => stopResize?.()
  stopResize = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    resizing.value = false
    delete document.documentElement.dataset.viewerResizing
    stopResize = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
function resizeWithKeyboard(event: KeyboardEvent) {
  const deltas: Record<string, number> = { ArrowLeft: 16, ArrowRight: -16 }
  if (event.key in deltas) {
    event.preventDefault()
    applyWidth(panelWidth.value + deltas[event.key])
  } else if (event.key === 'Home') {
    event.preventDefault()
    applyWidth(WIDTH_MIN)
  } else if (event.key === 'End') {
    event.preventDefault()
    applyWidth(WIDTH_MAX)
  }
}
function selectTab(id: string | null) {
  activeTabId.value = id
  const tab = tabs.value.find(item => item.id === id)
  emit('active-change',
    tab?.kind === 'note'
      ? 'note'
      : tab?.kind === 'side-chat'
        ? 'side-chat'
        : tab
          ? 'attachments'
          : 'activity',
  )
}
function showActivity() { selectTab(null) }
function showNote() {
  if (!tabs.value.some(tab => tab.id === NOTE_TAB_ID)) {
    tabs.value.push({ id: NOTE_TAB_ID, kind: 'note', label: 'Markdown 笔记' })
  }
  selectTab(NOTE_TAB_ID)
}
function showAttachment(attachment: ViewerAttachment) {
  const id = `file:${attachment.id || attachment.url || attachment.filename || tabs.value.length}`
  if (!tabs.value.some(tab => tab.id === id)) {
    tabs.value.push({ id, kind: 'file', label: attachment.filename || '附件', attachment })
  }
  selectTab(id)
}
function showWeb(url: string) {
  const id = `web:${url}`
  if (!tabs.value.some(tab => tab.id === id)) tabs.value.push({ id, kind: 'web', label: url.replace(/^https?:\/\//, ''), url })
  selectTab(id)
}
function closeTab(id: string) {
  const index = tabs.value.findIndex(tab => tab.id === id)
  if (index < 0) return
  const [closed] = tabs.value.splice(index, 1)
  if (closed.objectUrl) URL.revokeObjectURL(closed.objectUrl)
  if (activeTabId.value === id) selectTab(tabs.value[Math.max(0, index - 1)]?.id || null)
}
function openLauncher() { selectTab(NEW_TAB_ID) }
function openUrl() {
  const value = urlDraft.value.trim()
  if (!value) return
  showWeb(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  urlDraft.value = ''
}
function openLocalFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const objectUrl = URL.createObjectURL(file)
  const id = `local:${file.name}:${file.lastModified}`
  tabs.value.push({
    id,
    kind: 'file',
    label: file.name,
    objectUrl,
    attachment: { type: file.type.startsWith('image/') ? 'image' : 'file', filename: file.name, mime_type: file.type, url: objectUrl, size_bytes: file.size },
  })
  selectTab(id)
  input.value = ''
}
function openSideChat(options: SideChatOption = {}) {
  const responder = options.responder || DITO
  if (options.sessionId) {
    const existing = tabs.value.find(tab => tab.followupSessionId === options.sessionId)
    if (existing) {
      selectTab(existing.id)
      return
    }
    const id = `side-thread:${options.sessionId}`
    tabs.value.push({
      id,
      kind: 'side-chat',
      label: responder.kind === 'dito' ? 'Dito 侧边对话' : responder.name,
      sideChat: {
        parentSessionId: props.sessionId && props.sessionId !== 'pending' ? props.sessionId : null,
        leafMessageId: null,
        parentTitle: options.parentTitle || props.sessionTitle,
        responder,
      },
      followupSessionId: options.sessionId,
    })
    selectTab(id)
    return
  }
  const responderId = 'id' in responder ? responder.id : ''
  const seedQuote = options.quote
    ? { id: options.seedId || Date.now(), text: options.quote.slice(0, 12_000) }
    : null
  const matching = tabs.value.filter(
    (tab): tab is ViewerTab & { kind: 'side-chat' } =>
      tab.kind === 'side-chat' &&
      tab.sideChat?.responder.kind === responder.kind &&
      (!responderId || ('id' in tab.sideChat.responder && tab.sideChat.responder.id === responderId)),
  )
  if (seedQuote && matching.length) {
    const target = matching.find(tab => tab.id === activeTabId.value) || matching[matching.length - 1]
    if (target) {
      target.seedQuote = seedQuote
      selectTab(target.id)
      return
    }
  }
  if (!seedQuote) {
    const blank = matching.find(tab => !tab.followupSessionId)
    if (blank) {
      selectTab(blank.id)
      return
    }
  }
  const id = sideChatKey(props.sessionId || null)
  const context: SideChatContext = {
    parentSessionId: props.sessionId && props.sessionId !== 'pending' ? props.sessionId : null,
    leafMessageId: props.messages.filter(message => typeof message.id === 'number').at(-1)?.id || null,
    parentTitle: options.parentTitle || props.sessionTitle,
    responder,
  }
  tabs.value.push({ id, kind: 'side-chat', label: responder.kind === 'dito' ? 'Dito 侧边对话' : responder.name, sideChat: context, seedQuote })
  selectTab(id)
}
async function loadSideThreads() {
  if (!props.sessionId || props.sessionId === 'pending') {
    sideThreads.value = []
    return
  }
  sideThreadsLoading.value = true
  try {
    const result = await api<{ threads?: SideThread[] }>(
      `/api/sessions/${encodeURIComponent(props.sessionId)}/threads`,
    )
    sideThreads.value = Array.isArray(result.threads) ? result.threads : []
  } catch {
    sideThreads.value = []
  } finally {
    sideThreadsLoading.value = false
  }
}
function openSideChatThread(thread: SideThread) {
  openSideChat({
    responder: responderFromPreferences(thread.preferences),
    sessionId: thread.session_id,
    parentTitle: props.sessionTitle,
  })
}
function onSideChatSessionId(tabId: string, sessionId: string) {
  const tab = tabs.value.find(item => item.id === tabId)
  if (tab) tab.followupSessionId = sessionId
}
function onSideChatResponder(tabId: string, responder: SideChatResponder) {
  const tab = tabs.value.find(item => item.id === tabId)
  if (tab?.sideChat) {
    tab.sideChat = { ...tab.sideChat, responder }
    tab.label = responder.kind === 'dito' ? 'Dito 侧边对话' : responder.name
  }
}
function openSubagentTab(key: string, label: string, events: SubagentEvent[], forceFocus = false) {
  const id = `subagent:${key}`
  const isNew = !subagentSeen.has(key)
  subagentSeen.add(key)
  const existing = tabs.value.find(tab => tab.id === id)
  if (existing) {
    existing.subagentEvents = events
    existing.label = label
  } else {
    tabs.value.push({ id, kind: 'subagent', label, subagentEvents: events })
  }
  if (isNew || forceFocus) selectTab(id)
}
function fileUrl(attachment?: ViewerAttachment) {
  if (!attachment) return ''
  return props.attachmentHref(attachment)
}
function formatSize(value?: number) {
  if (!value || value < 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
function onDocumentKeydown(event: KeyboardEvent) {
  if (!props.open || event.key !== 'Escape') return
  event.stopPropagation()
  emit('close')
}
watch(() => props.sessionId, (next, previous) => {
  const nextKey = next || 'pending'
  const previousKey = previous || 'pending'
  if (nextKey === previousKey) return
  if (previousKey === 'pending') {
    tabStates.delete(previousKey)
    tabStates.set(nextKey, { tabs: tabs.value, activeTabId: activeTabId.value })
    return
  }
  tabStates.set(previousKey, { tabs: tabs.value, activeTabId: activeTabId.value })
  const restored = tabStates.get(nextKey)
  tabs.value = restored?.tabs || []
  selectTab(restored?.activeTabId || null)
})
watch(() => props.open, open => {
  if (open) document.addEventListener('keydown', onDocumentKeydown)
  else document.removeEventListener('keydown', onDocumentKeydown)
})
watch(activeTabId, () => {
  if (activeTabId.value !== NEW_TAB_ID) urlDraft.value = ''
})
watch([launcherActive, () => props.open, () => props.sessionId], ([launcher, open]) => {
  if (launcher && open) void loadSideThreads()
}, { immediate: true })
onMounted(() => {
  const stored = Number(localStorage.getItem(WIDTH_KEY))
  applyWidth(Number.isFinite(stored) && stored > 0 ? stored : WIDTH_DEFAULT)
  if (props.open) document.addEventListener('keydown', onDocumentKeydown)
})
onUnmounted(() => {
  stopResize?.()
  document.removeEventListener('keydown', onDocumentKeydown)
  for (const tab of tabs.value) if (tab.objectUrl) URL.revokeObjectURL(tab.objectUrl)
})
defineExpose({ showActivity, showNote, showAttachment, openSideChat, openSubagentTab })
</script>

<template>
  <aside
    class="dt-viewer-panel activity-panel"
    role="dialog"
    aria-label="会话活动与预览"
    :aria-hidden="!open"
    :data-open="open ? 'true' : 'false'"
    :data-resizing="resizing ? 'true' : 'false'"
    :style="{ width: 'var(--viewer-width, 520px)' }"
  >
    <div class="dt-viewer-resize" role="separator" aria-orientation="vertical" aria-label="调整预览面板宽度" tabindex="0" @pointerdown="startResize" @keydown="resizeWithKeyboard"><span /></div>
    <header class="dt-viewer-tabbar">
      <div class="dt-viewer-tabs" role="tablist" aria-label="预览标签页">
        <button type="button" class="dt-viewer-home-tab" :aria-pressed="!activeTab && !launcherActive" @click="showActivity"><LegacyIcon name="activity" :size="13" /><span>活动</span></button>
        <div v-for="tab in tabs" :key="tab.id" class="dt-viewer-tab" :class="{ 'is-active': activeTabId === tab.id }">
          <button type="button" :aria-label="tab.label" :aria-pressed="activeTabId === tab.id" @click="selectTab(tab.id)"><LegacyIcon :name="tab.kind === 'note' ? 'notebookPen' : tab.kind === 'web' ? 'network' : tab.kind === 'side-chat' ? 'chat' : tab.kind === 'subagent' ? 'agents' : 'document'" :size="13" /><span>{{ tab.label }}</span></button>
          <button type="button" class="dt-viewer-tab-close" aria-label="关闭标签页" :title="`关闭 ${tab.label}`" @click.stop="closeTab(tab.id)"><LegacyIcon name="close" :size="12" /></button>
        </div>
      </div>
      <template v-if="activeTab?.kind === 'file' && fileUrl(activeTab.attachment)">
        <a class="dt-viewer-header-icon" :href="fileUrl(activeTab.attachment)" :download="activeTab.attachment?.filename" aria-label="下载文件" title="下载文件"><LegacyIcon name="fileDown" :size="15" /></a>
        <a class="dt-viewer-header-icon" :href="fileUrl(activeTab.attachment)" target="_blank" rel="noopener" aria-label="在浏览器中打开" title="在浏览器中打开"><LegacyIcon name="cornerUpRight" :size="15" /></a>
      </template>
      <a v-else-if="activeTab?.kind === 'web'" class="dt-viewer-header-icon" :href="activeTab.url" target="_blank" rel="noopener" aria-label="在浏览器中打开" title="在浏览器中打开"><LegacyIcon name="cornerUpRight" :size="15" /></a>
      <button type="button" class="dt-viewer-header-icon" aria-label="新建标签页" title="新建标签页" @click="openLauncher"><LegacyIcon name="plus" :size="16" /></button>
      <button type="button" class="dt-viewer-header-icon" aria-label="关闭预览面板" title="关闭预览面板" @click="emit('close')"><LegacyIcon name="close" :size="15" /></button>
    </header>

    <div class="dt-viewer-content">
      <div v-if="launcherActive" class="dt-viewer-launcher">
        <form class="dt-viewer-address" @submit.prevent="openUrl"><LegacyIcon name="network" :size="15" /><input v-model="urlDraft" aria-label="打开网址" placeholder="输入网址"><button type="submit" aria-label="前往网址"><LegacyIcon name="chevronRight" :size="15" /></button></form>
        <section><h2>工具</h2><div class="dt-viewer-tool-grid">
          <button type="button" @click="showNote"><LegacyIcon name="notebookPen" :size="18" /><strong>Markdown 笔记</strong><span>与这段对话一起保存的草稿页。</span></button>
          <button type="button" @click="openSideChat()"><LegacyIcon name="chat" :size="18" /><strong>侧边对话</strong><span>让 Dito、伙伴或子智能体在独立会话中回答，不写回主聊天。</span></button>
          <button type="button" @click="localFileInput?.click()"><LegacyIcon name="document" :size="18" /><strong>打开本地文件</strong><span>预览 PDF、图片、视频、文档或代码文件。</span></button>
        </div></section>
        <section v-if="sideThreadsForLauncher.length || sideThreadsLoading" class="side-thread-list">
          <h2>这段对话的侧边对话</h2>
          <p v-if="sideThreadsLoading" class="muted">正在加载…</p>
          <button v-for="thread in sideThreadsForLauncher" :key="thread.session_id" type="button" @click="openSideChatThread(thread)">
            <LegacyIcon name="chat" :size="15" />
            <span><strong>{{ thread.title || '侧边对话' }}</strong><small>继续之前的独立讨论</small></span>
            <LegacyIcon name="chevronRight" :size="13" />
          </button>
        </section>
        <p class="dt-viewer-launcher-hint">回复中的文件和链接也会在这里打开。你可以随时新建标签页，或关闭不需要的标签页。</p>
        <input ref="localFileInput" type="file" hidden tabindex="-1" @change="openLocalFile">
      </div>

      <div v-else-if="activeTab?.kind === 'note'" class="dt-viewer-note">
        <textarea :value="note" aria-label="Markdown 笔记" placeholder="用 Markdown 记录这段对话的要点…" @input="emit('update:note', ($event.target as HTMLTextAreaElement).value)" />
        <p>内容保存在当前浏览器，并与这段对话关联。</p>
      </div>

      <div v-else-if="activeTab?.kind === 'file'" class="dt-viewer-file">
        <img v-if="activeTab.attachment?.mime_type?.startsWith('image/') || activeTab.attachment?.type === 'image'" :src="fileUrl(activeTab.attachment)" :alt="activeTab.label">
        <iframe v-else-if="activeTab.attachment?.mime_type === 'application/pdf'" :src="fileUrl(activeTab.attachment)" :title="activeTab.label" />
        <pre v-else-if="activeTab.attachment?.extracted_text">{{ activeTab.attachment.extracted_text }}</pre>
        <div v-else class="dt-viewer-file-empty"><LegacyIcon name="document" :size="30" /><h2>{{ activeTab.label }}</h2><p>此文件暂不支持内嵌预览，请下载后查看。</p><a :href="fileUrl(activeTab.attachment)" :download="activeTab.attachment?.filename">下载附件</a></div>
      </div>
      <div v-else-if="activeTab?.kind === 'web'" class="dt-viewer-web"><iframe :src="activeTab.url" :title="activeTab.label" /></div>
      <ConsultationTabBody
        v-else-if="activeTab?.kind === 'subagent'"
        :key="activeTab.id"
        :events="activeTab.subagentEvents || []"
        :session-id="sessionId === 'pending' ? null : sessionId"
      />
      <div v-else-if="activeTab?.kind !== 'side-chat'" class="dt-viewer-activity">
        <div class="dt-viewer-back-row"><button type="button" @click="emit('close')"><LegacyIcon name="arrowLeft" :size="16" />返回对话</button></div>
        <TaskPanelSection :board="taskBoard" :session-id="sessionId || null" :workspace-id="workspaceId" :draft-task-ids="taskDraftIds" @update:board="emit('update:task-board', $event)" @update:draft-task-ids="emit('update:task-draft-ids', $event)" />
        <section v-if="activityEmpty" class="dt-viewer-activity-section"><h2>会话活动</h2><div class="dt-viewer-empty-tile"><LegacyIcon name="tool" :size="15" /><p>随着你聊天，使用过的工具和引用、以及 AI 导师生成的文件会显示在这里。</p></div></section>
        <section v-else class="dt-viewer-activity-section"><h2>会话活动</h2><div class="dt-viewer-activity-tile">
          <section v-if="toolUses.length" class="dt-viewer-card"><header><LegacyIcon name="tool" :size="14" /><h3>工具使用</h3><span>{{ toolUses.length }}</span></header><ul><li v-for="tool in toolUses" :key="tool.name"><span>{{ tool.name }}</span><span>×{{ tool.count }}</span></li></ul></section>
          <section v-if="activityEvents.length" class="dt-viewer-card"><header><LegacyIcon name="activity" :size="14" /><h3>运行记录</h3><span>{{ activityEvents.length }}</span></header><details v-for="(event, index) in activityEvents" :key="index"><summary>{{ event.type }}</summary><p>{{ event.content || event.message || event.status }}</p></details></section>
          <section v-if="attachments.length" class="dt-viewer-card"><header><LegacyIcon name="attachment" :size="14" /><h3>附件</h3><span>{{ attachments.length }}</span></header><ul><li v-for="(attachment, index) in attachments" :key="attachment.id || index"><button type="button" class="dt-viewer-attachment" @click="showAttachment(attachment)"><span class="dt-viewer-file-icon"><LegacyIcon name="document" :size="14" /></span><span><strong>{{ attachment.filename || '附件' }}</strong><small>{{ [attachment.mime_type || '文件', formatSize(attachment.size_bytes)].filter(Boolean).join(' · ') }}</small></span><LegacyIcon name="chevronRight" :size="14" /></button></li></ul></section>
        </div></section>
        <slot name="config" />
      </div>
      <SideChatPanel
        v-for="tab in tabs.filter(item => item.kind === 'side-chat' && item.sideChat)"
        v-show="activeTabId === tab.id"
        :key="tab.id"
        :context="tab.sideChat!"
        :initial-session-id="tab.followupSessionId"
        :seed-quote="tab.seedQuote"
        :language="language"
        :agents="agents"
        :partners="partners"
        :groups="groups"
        :llm-options="llmOptions"
        :initial-model="initialModel"
        :knowledge-bases="knowledgeBases"
        :skills="skills"
        :mcp="mcp"
        :personas="personas"
        @session-id="onSideChatSessionId(tab.id, $event)"
        @responder-change="onSideChatResponder(tab.id, $event)"
      />
    </div>
  </aside>
</template>
