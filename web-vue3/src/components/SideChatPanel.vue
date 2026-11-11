<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownView from './MarkdownView.vue'
import TurnActivityStream from './TurnActivityStream.vue'
import SideChatResponderMenu from './SideChatResponderMenu.vue'
import SideChatResourcesMenu, { type SideChatResourceValue } from './SideChatResourcesMenu.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import AskUserCard from './AskUserCard.vue'
import QuestionBankPicker from './QuestionBankPicker.vue'
import NotebookRecordPicker from './NotebookRecordPicker.vue'
import BookReferencePicker from './BookReferencePicker.vue'
import ReadingReferencePicker from './ReadingReferencePicker.vue'
import HistorySessionPicker from './HistorySessionPicker.vue'
import MemoryPicker from './MemoryPicker.vue'
import { api } from '../api'
import { scopedUrl, scopedWebSocketUrl } from '../workspaceScope'
import LegacyIcon from './LegacyIcon.vue'
import { ATTACHMENT_ACCEPT, classifyFile, DEFAULT_MAX_ATTACHMENT_BYTES } from '../attachmentTypes'
import { extractAskUserPayload, type AskUserCardData } from '../askUser'
import { quoteAttachment, quoteText, type QuotePendingAttachmentLike } from '../quoteAttachments'
import { selectedRecordsToPayload, type SelectedNotebookRecord } from '../notebookReferences'
import { selectedBooksToPayload, type SelectedBookReference } from '../bookReferences'
import { countSelectedReadingUnits, selectedReadingsToPayload, type SelectedReadingReference } from '../readingReferences'
import {
  normalizeResourceReuse,
  retainedKnowledgeBases,
  type ResourceReusePolicy,
} from '../resourceReuse'
import {
  applySideChatEvent,
  buildSideChatStartCommand,
  emptySideChatState,
  type SideChatAttachment,
  type SideChatContext,
  type SideChatEvent,
  type SideChatResponder,
} from '../sideChat'

const props = withDefaults(defineProps<{
  context: SideChatContext
  language?: string | null
  initialSessionId?: string | null
  seedQuote?: { id: number; text: string } | null
  agents?: Array<{ name: string; kind?: string }>
  partners?: Array<{ partner_id: string; name: string; emoji?: string; color?: string; avatar?: string; description?: string }>
  groups?: Array<{ group_id: string; name: string; emoji?: string; description?: string }>
  llmOptions?: Array<{ profile_id: string; model_id: string; profile_name?: string; model_name?: string }>
  initialModel?: string
  knowledgeBases?: Array<{ name: string; metadata?: { type?: string } }>
  skills?: Array<{ id: string; name: string }>
  mcp?: Array<{ id: string; name: string }>
  personas?: Array<{ id: string; name: string }>
}>(), {
  language: null,
  initialSessionId: null,
  seedQuote: null,
  agents: () => [],
  partners: () => [],
  groups: () => [],
  llmOptions: () => [],
  initialModel: '',
  knowledgeBases: () => [],
  skills: () => [],
  mcp: () => [],
  personas: () => [],
})
const emit = defineEmits<{
  'session-id': [sessionId: string]
  'responder-change': [responder: SideChatResponder]
}>()

const state = ref(emptySideChatState(props.initialSessionId || ''))
const input = ref('')
const threadRoot = ref<HTMLElement | null>(null)
const socket = ref<WebSocket | null>(null)
const pendingQuote = ref<QuotePendingAttachmentLike | null>(null)
const pendingFiles = ref<SideChatAttachment[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const resources = ref<SideChatResourceValue>({
  modelId: props.initialModel,
  persona: '',
  knowledgeBases: [],
  skills: [],
  mcp: [],
})
type SidePickerKind = '' | 'questions' | 'notebooks' | 'books' | 'reading' | 'history' | 'memory'
type HistoryReference = { sessionId: string; title: string }
type MemoryFile = 'summary' | 'profile'
const openPicker = ref<SidePickerKind>('')
const selectedQuestionIds = ref<number[]>([])
const selectedNotebooks = ref<SelectedNotebookRecord[]>([])
const selectedBooks = ref<SelectedBookReference[]>([])
const selectedReadings = ref<SelectedReadingReference[]>([])
const selectedHistory = ref<HistoryReference[]>([])
const selectedMemory = ref<MemoryFile[]>([])
const resourceReuse = ref<ResourceReusePolicy>(normalizeResourceReuse())
const referenceCounts = computed(() => ({
  questions: selectedQuestionIds.value.length,
  notebooks: selectedNotebooks.value.length,
  books: selectedBooks.value.reduce((total, book) => total + book.pages.length, 0),
  reading: countSelectedReadingUnits(selectedReadings.value),
  history: selectedHistory.value.length,
  memory: selectedMemory.value.length,
}))
const responder = ref<SideChatResponder>(props.context.responder)
const usedQuoteIds = new Set<number>()
const context = computed<SideChatContext>(() => ({ ...props.context, responder: responder.value }))
const canSend = computed(() => input.value.trim().length > 0 && !state.value.busy)
const placeholder = computed(() =>
  context.value.responder.kind === 'dito'
    ? '向 Dito 提问…'
    : `向 ${'name' in context.value.responder ? context.value.responder.name : 'Dito'} 提问…`,
)
const askUser = computed<AskUserCardData | null>(() =>
  extractAskUserPayload([
    ...state.value.messages.flatMap(message => message.events || []),
    ...state.value.streamEvents,
  ], { streaming: state.value.busy }),
)
const pendingAskUser = computed(() =>
  askUser.value && !askUser.value.resolved && !askUser.value.answers ? askUser.value : null,
)

watch(() => props.seedQuote, value => {
  if (!value || usedQuoteIds.has(value.id)) return
  const quote = quoteAttachment(value.text)
  if (quote) pendingQuote.value = quote
}, { immediate: true })
watch(() => props.context.responder, value => { responder.value = value })

async function hydrate() {
  if (!props.initialSessionId || state.value.messages.length) return
  try {
    const detail = await api<{ messages?: Array<{ role?: string; content?: string; events?: SideChatEvent[]; attachments?: Array<{ type?: string; text?: string; base64?: string; extracted_text?: string }> }> }>(
      `/api/sessions/${encodeURIComponent(props.initialSessionId)}`,
    )
    state.value = {
      ...emptySideChatState(props.initialSessionId),
      messages: (detail.messages || [])
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => ({
          role: message.role as 'user' | 'assistant',
          content: message.content || '',
          events: message.events,
          quotes: (message.attachments || []).filter(item => item.type === 'quote').map(quoteText),
        })),
    }
  } catch {
    /* A new side chat has no persisted transcript yet. */
  }
}

function handleMessage(event: MessageEvent) {
  let value: SideChatEvent
  try { value = JSON.parse(event.data) } catch { return }
  const previous = state.value.sessionId
  state.value = applySideChatEvent(state.value, value)
  if (!previous && state.value.sessionId) emit('session-id', state.value.sessionId)
  if (value.type === 'done' || value.type === 'error' || value.type === 'protocol_error') socket.value?.close()
}

function send() {
  const content = input.value.trim()
  if (!content || !canSend.value) return
  const reuse = resourceReuse.value
  const quote = pendingQuote.value
  const attachments: SideChatAttachment[] = quote
    ? [{ type: quote.type, filename: quote.filename, base64: quote.base64, mime_type: quote.mime_type }]
    : []
  attachments.push(...pendingFiles.value)
  if (props.seedQuote) usedQuoteIds.add(props.seedQuote.id)
  pendingQuote.value = null
  const command = buildSideChatStartCommand({
    content,
    context: context.value,
    sessionId: state.value.sessionId || null,
    language: props.language,
    attachments,
    knowledgeBases: resources.value.knowledgeBases,
    skills: resources.value.skills,
    mcp: resources.value.mcp,
    persona: resources.value.persona || null,
    llmSelection: resources.value.modelId.includes(':')
      ? {
          profile_id: resources.value.modelId.split(':')[0] || '',
          model_id: resources.value.modelId.split(':').slice(1).join(':'),
        }
      : null,
    notebookReferences: selectedRecordsToPayload(selectedNotebooks.value),
    historyReferences: selectedHistory.value.map(item => item.sessionId),
    bookReferences: selectedBooksToPayload(selectedBooks.value),
    readingReferences: selectedReadingsToPayload(selectedReadings.value),
    questionNotebookReferences: selectedQuestionIds.value,
    memoryReferences: selectedMemory.value,
    config: {
      _resource_reuse: reuse,
      _persistent_knowledge_bases: retainedKnowledgeBases(
        resources.value.knowledgeBases,
        new Set(),
        reuse,
      ),
    },
  })
  state.value = {
    ...state.value,
    messages: [...state.value.messages, { role: 'user', content, quotes: quote ? [quote.text] : [] }],
    busy: true,
    error: '',
  }
  input.value = ''
  if (!reuse.attachments) pendingFiles.value = []
  if (!reuse.question_bank) selectedQuestionIds.value = []
  if (!reuse.notebooks) selectedNotebooks.value = []
  if (!reuse.books) selectedBooks.value = []
  if (!reuse.reading) selectedReadings.value = []
  if (!reuse.chat_history) selectedHistory.value = []
  if (!reuse.memory) selectedMemory.value = []
  if (!reuse.persona) resources.value = { ...resources.value, persona: '' }
  if (!reuse.knowledge) resources.value = { ...resources.value, knowledgeBases: [] }
  if (!reuse.skills) resources.value = { ...resources.value, skills: [] }
  if (!reuse.mcp) resources.value = { ...resources.value, mcp: [] }
  const ws = new WebSocket(scopedWebSocketUrl('/ws'))
  socket.value = ws
  ws.onopen = () => ws.send(JSON.stringify(command))
  ws.onmessage = handleMessage
  ws.onerror = () => {
    state.value = { ...state.value, error: 'Side chat 连接失败', busy: false }
  }
  ws.onclose = () => {
    if (state.value.busy) state.value = { ...state.value, busy: false }
  }
  void scrollToEnd()
}

function cancel() {
  if (!state.value.activeTurnId || !socket.value) return
  socket.value.send(JSON.stringify({ type: 'cancel_turn', turn_id: state.value.activeTurnId }))
  socket.value.close()
}
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
async function selectFiles(event: Event) {
  const inputElement = event.target as HTMLInputElement
  const files = Array.from(inputElement.files || [])
  for (const file of files) {
    const kind = classifyFile(file)
    if (!kind || file.size > DEFAULT_MAX_ATTACHMENT_BYTES) continue
    try {
      const base64 = await readAsBase64(file)
      pendingFiles.value.push({
        type: kind === 'image' ? 'image' : 'file',
        filename: file.name,
        base64,
        mime_type: file.type,
        size_bytes: file.size,
        ...(kind === 'image' ? { previewUrl: `data:${file.type};base64,${base64}` } : {}),
      })
    } catch {
      state.value = { ...state.value, error: '附件读取失败' }
    }
  }
  inputElement.value = ''
}
function submitUserReply(payload: { text?: string; answers?: Array<{ questionId: string; text: string }> }) {
  const turnId = state.value.activeTurnId
  const socketInstance = socket.value
  if (!turnId || !socketInstance || socketInstance.readyState !== WebSocket.OPEN) return false
  const text = (payload.text || '').trim()
  if (!text && !payload.answers?.length) return false
  socketInstance.send(JSON.stringify({
    type: 'submit_user_reply',
    turn_id: turnId,
    ...(text ? { text } : {}),
    ...(payload.answers?.length ? { answers: payload.answers } : {}),
    command_id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  }))
  return true
}

function changeResponder(nextResponder: SideChatResponder) {
  responder.value = nextResponder
  emit('responder-change', nextResponder)
}

async function scrollToEnd() {
  await nextTick()
  const root = threadRoot.value
  if (root) root.scrollTop = root.scrollHeight
}

watch(() => state.value.messages.length, scrollToEnd)
watch(() => state.value.streaming, scrollToEnd)
onMounted(hydrate)
onBeforeUnmount(() => socket.value?.close())
</script>

<template>
  <section class="side-chat-panel">
    <div ref="threadRoot" class="side-chat-thread" data-chat-scroll-root="true">
      <section v-if="context.parentSessionId" class="side-chat-pinned">
        <h3>关于这段对话</h3>
        <p>{{ context.parentTitle || '当前对话' }}</p>
      </section>
      <p v-if="state.messages.length === 0" class="side-chat-empty">
        这是独立的侧边对话；这里提出的问题不会写入主聊天。可以引用原文，或让伙伴、群组、子智能体回答。
      </p>
      <template v-for="(message, index) in state.messages" :key="index">
        <div v-if="message.role === 'user'" class="side-chat-user">
          <blockquote v-for="(quote, quoteIndex) in message.quotes || []" :key="quoteIndex">{{ quote }}</blockquote>
          {{ message.content }}
        </div>
        <div v-else class="side-chat-assistant">
          <TurnActivityStream v-if="message.events?.length" :events="message.events.map(event => ({ ...event, type: event.type || 'event' }))" />
          <MarkdownView :content="message.content" />
        </div>
      </template>
      <TurnActivityStream v-if="state.streamEvents.length" :events="state.streamEvents.map(event => ({ ...event, type: event.type || 'event' }))" />
      <div v-if="state.streaming" class="side-chat-assistant"><MarkdownView :content="state.streaming" /></div>
      <AskUserCard
        v-if="askUser"
        :data="askUser"
        :disabled="!state.activeTurnId"
        @submit="submitUserReply"
      />
      <p v-if="state.error" class="side-chat-error" role="alert">{{ state.error }}</p>
    </div>
    <blockquote v-if="pendingQuote" class="side-chat-pending-quote">
      {{ pendingQuote.text }}
      <button type="button" aria-label="移除引用" @click="pendingQuote = null">×</button>
    </blockquote>
    <div v-if="!pendingAskUser" class="side-chat-composer">
      <div v-if="pendingFiles.length" class="side-chat-files">
        <ResourceReuseToggle v-model:every-turn="resourceReuse.attachments" />
        <span v-for="(file, index) in pendingFiles" :key="`${file.filename}-${index}`">
          <img v-if="file.previewUrl" :src="file.previewUrl" :alt="file.filename">
          <strong>{{ file.filename }}</strong>
          <button type="button" :aria-label="`移除附件 ${file.filename}`" @click="pendingFiles.splice(index, 1)">×</button>
        </span>
      </div>
      <SideChatResponderMenu
        :value="context.responder"
        :agents="agents"
        :partners="partners"
        :groups="groups"
        :about-conversation="Boolean(context.parentSessionId)"
        @change="changeResponder"
      />
      <SideChatResourcesMenu
        v-model="resources"
        :llm-options="llmOptions"
        :knowledge-bases="knowledgeBases"
        :skills="skills"
        :mcp="mcp"
        :personas="personas"
        :reference-counts="referenceCounts"
        :reuse="resourceReuse"
        @update:reuse="resourceReuse = $event"
        @pick="openPicker = $event"
      />
      <div class="side-chat-input-row">
        <button type="button" class="side-chat-attach" aria-label="添加附件" title="添加附件" @click="fileInput?.click()"><LegacyIcon name="attachment" :size="16" /></button>
        <input ref="fileInput" type="file" hidden multiple :accept="ATTACHMENT_ACCEPT" @change="selectFiles">
        <textarea v-model="input" rows="2" :placeholder="placeholder" :disabled="state.busy" @keydown.enter.exact.prevent="send" />
        <button v-if="state.busy" type="button" class="is-stop" @click="cancel">停止</button>
        <button v-else type="button" :disabled="!canSend" @click="send">发送</button>
      </div>
    </div>
    <QuestionBankPicker :open="openPicker === 'questions'" :initial="selectedQuestionIds" v-model:every-turn="resourceReuse.question_bank" @close="openPicker = ''" @apply="selectedQuestionIds = $event" />
    <NotebookRecordPicker :open="openPicker === 'notebooks'" :initial="selectedNotebooks" v-model:every-turn="resourceReuse.notebooks" @close="openPicker = ''" @apply="selectedNotebooks = $event" />
    <BookReferencePicker :open="openPicker === 'books'" :initial="selectedBooks" v-model:every-turn="resourceReuse.books" @close="openPicker = ''" @apply="selectedBooks = $event" />
    <ReadingReferencePicker :open="openPicker === 'reading'" :initial="selectedReadings" v-model:every-turn="resourceReuse.reading" @close="openPicker = ''" @apply="selectedReadings = $event" />
    <HistorySessionPicker :open="openPicker === 'history'" :initial="selectedHistory" v-model:every-turn="resourceReuse.chat_history" @close="openPicker = ''" @apply="selectedHistory = $event" />
    <MemoryPicker :open="openPicker === 'memory'" :initial="selectedMemory" v-model:every-turn="resourceReuse.memory" @close="openPicker = ''" @apply="selectedMemory = $event" />
  </section>
</template>
