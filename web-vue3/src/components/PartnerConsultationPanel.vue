<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownView from './MarkdownView.vue'
import PartnerAvatar from './PartnerAvatar.vue'
import PartnerGroupDiscussion from './PartnerGroupDiscussion.vue'
import LegacyIcon from './LegacyIcon.vue'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'

type ConsultationMessage = {
  role: string
  content: string
  author_name?: string
  created_at?: string
  timestamp?: string
}
type PartnerSession = {
  session_key: string
  title?: string
  archived?: boolean
  updated_at?: string
  message_count?: number
}
type PendingAttachment = {
  type: 'image' | 'file'
  filename: string
  base64: string
  mime_type?: string
  previewUrl?: string
}

const props = defineProps<{
  kind: 'partner' | 'group'
  id: string
  sessionKey: string
  name: string
  emoji?: string
  color?: string
  avatar?: string
}>()
const emit = defineEmits<{ activity: [] }>()
const base = computed(() =>
  props.kind === 'partner'
    ? `/api/partners/${encodeURIComponent(props.id)}`
    : `/api/partner-groups/${encodeURIComponent(props.id)}`,
)
const messages = ref<ConsultationMessage[]>([])
const activeSessionKey = ref(props.sessionKey)
const sessions = ref<PartnerSession[]>([])
const input = ref('')
const draft = ref('')
const busy = ref(false)
const error = ref('')
const thread = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const attachments = ref<PendingAttachment[]>([])
const attachmentError = ref('')
const dragging = ref(false)
let abort: AbortController | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

const canSend = computed(() => Boolean(input.value.trim() || attachments.value.length) && !busy.value)

async function loadHistory() {
  if (!props.id || props.kind === 'group') return
  try {
    if (!activeSessionKey.value) {
      messages.value = []
      return
    }
    const params = new URLSearchParams({ limit: '200', session_key: activeSessionKey.value })
    messages.value = await api<ConsultationMessage[]>(`${base.value}/history?${params}`)
    await scrollToEnd()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '咨询记录加载失败'
  }
}

async function loadSessions() {
  if (props.kind !== 'partner') return
  sessions.value = await api<PartnerSession[]>(`${base.value}/sessions`).catch(() => [])
}

function processSse(block: string) {
  let eventName = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return
  const raw = data.join('\n')
  try {
    const payload = JSON.parse(raw) as { content?: string; detail?: string; session_key?: string; session_id?: string }
    if (payload.session_key || payload.session_id) activeSessionKey.value = payload.session_key || payload.session_id || activeSessionKey.value
    if (eventName === 'content') draft.value = String(payload.content || '')
    else if (eventName === 'error') error.value = String(payload.detail || payload.content || '伙伴回复失败')
  } catch {
    if (eventName === 'content') draft.value = raw
  }
}

async function sendPartner(content: string, pending: PendingAttachment[] = []) {
  abort = new AbortController()
  const response = await fetch(scopedUrl(`${base.value}/chat/execute-stream`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      ...(activeSessionKey.value ? { session_key: activeSessionKey.value } : {}),
      attachments: pending,
    }),
    signal: abort.signal,
  })
  if (!response.ok || !response.body) throw new Error(`伙伴回复失败（HTTP ${response.status}）`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''
    for (const block of blocks) processSse(block)
  }
  buffer += decoder.decode()
  if (buffer.trim()) processSse(buffer)
}

function scheduleGroupRefresh() {
  if (pollTimer) clearInterval(pollTimer)
  let attempts = 5
  pollTimer = setInterval(async () => {
    await loadHistory()
    attempts -= 1
    if (attempts <= 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }, 1500)
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('读取附件失败'))
    reader.readAsDataURL(file)
  })
}

async function addFiles(files: File[]) {
  attachmentError.value = ''
  const accepted: PendingAttachment[] = []
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      attachmentError.value = `文件过大：${file.name}`
      continue
    }
    try {
      const base64 = await readAsBase64(file)
      accepted.push({
        type: file.type.startsWith('image/') && file.type !== 'image/svg+xml' ? 'image' : 'file',
        filename: file.name,
        base64,
        mime_type: file.type || undefined,
        previewUrl: file.type.startsWith('image/') ? `data:${file.type};base64,${base64}` : undefined,
      })
    } catch {
      attachmentError.value = `无法读取：${file.name}`
    }
  }
  attachments.value = [...attachments.value, ...accepted].slice(0, 10)
}

async function selectFiles(event: Event) {
  const element = event.target as HTMLInputElement
  await addFiles(Array.from(element.files || []))
  element.value = ''
}

async function pasteFiles(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  if (!files.length) return
  event.preventDefault()
  await addFiles(files)
}

async function dropFiles(event: DragEvent) {
  dragging.value = false
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) await addFiles(files)
}

async function archiveCurrent() {
  if (!activeSessionKey.value) return
  try {
    await post(`${base.value}/sessions/archive`, { session_key: activeSessionKey.value })
    messages.value = []
    activeSessionKey.value = ''
    await loadSessions()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '归档失败'
  }
}

async function handleCommand(content: string): Promise<boolean> {
  if (!content.startsWith('/')) return false
  const [command, ...rest] = content.split(/\s+/)
  const argument = rest.join(' ').trim()
  if (command === '/new') {
    activeSessionKey.value = ''
    messages.value = []
    return true
  }
  if (command === '/clear') {
    if (messages.value.length) await archiveCurrent()
    else {
      activeSessionKey.value = ''
      messages.value = []
    }
    return true
  }
  if (command === '/branch') {
    if (!activeSessionKey.value) {
      error.value = '当前会话还没有可分支的内容'
      return true
    }
    try {
      const result = await post<{ active_session_key?: string; session?: PartnerSession }>(
        `${base.value}/sessions/branch`,
        {
          source_key: activeSessionKey.value,
          new_key: `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        },
      )
      activeSessionKey.value = result.active_session_key || result.session?.session_key || activeSessionKey.value
      await loadSessions()
      await loadHistory()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '创建会话分支失败'
    }
    return true
  }
  if (command === '/resume' && argument) {
    activeSessionKey.value = argument
    await loadHistory()
    return true
  }
  if (command === '/delete' && argument) {
    try {
      await post(`${base.value}/sessions/delete`, { session_key: argument })
      if (argument === activeSessionKey.value) {
        activeSessionKey.value = ''
        messages.value = []
      }
      await loadSessions()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '删除会话失败'
    }
    return true
  }
  if (command === '/sessions') {
    await loadSessions()
    messages.value.push({
      role: 'assistant',
      content: `对话：\n${sessions.value.slice(0, 30).map(row =>
        `- \`${row.session_key}\`${row.archived ? '（已归档）' : ''} — ${row.title || '新对话'}`).join('\n')}\n\n使用 /resume <会话 ID> 或 /delete <会话 ID>。`,
    })
    return true
  }
  return false
}

async function send() {
  const content = input.value.trim()
  if ((!content && !attachments.value.length) || busy.value) return
  if (!attachments.value.length && await handleCommand(content)) {
    input.value = ''
    return
  }
  const pending = [...attachments.value]
  const visibleContent = content || (pending.every(item => item.type === 'image') ? '请分析所附图片。' : '请使用所附文件。')
  input.value = ''
  busy.value = true
  error.value = ''
  try {
    messages.value.push({
      role: 'user',
      content: visibleContent,
      created_at: new Date().toISOString(),
    })
    await scrollToEnd()
    let streamed = ''
    if (props.kind === 'partner') {
      await sendPartner(visibleContent, pending)
      streamed = draft.value
    } else {
      await post(`${base.value}/messages`, { content: visibleContent, session_key: props.sessionKey })
      scheduleGroupRefresh()
    }
    if (!activeSessionKey.value && props.kind === 'partner') {
      await loadSessions()
      const latest = sessions.value.find(row => !row.archived) || sessions.value[0]
      if (latest) activeSessionKey.value = latest.session_key
    }
    await loadHistory()
    if (streamed && messages.value.at(-1)?.content !== streamed) {
      messages.value.push({
        role: 'assistant',
        content: streamed,
        created_at: new Date().toISOString(),
      })
    }
  } catch (cause) {
    if ((cause as Error).name !== 'AbortError') error.value = cause instanceof Error ? cause.message : '发送失败'
  } finally {
    busy.value = false
    draft.value = ''
    attachments.value = []
    attachmentError.value = ''
    dragging.value = false
    abort = null
  }
}

function stop() {
  abort?.abort()
  abort = null
  busy.value = false
  draft.value = ''
}

async function scrollToEnd() {
  await nextTick()
  if (thread.value) thread.value.scrollTop = thread.value.scrollHeight
}

watch(() => props.sessionKey, value => {
  if (props.kind === 'partner') activeSessionKey.value = value
  void loadHistory()
})
onMounted(() => {
  void loadHistory()
  void loadSessions()
})
onBeforeUnmount(() => {
  stop()
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <PartnerGroupDiscussion
    v-if="kind === 'group'"
    :group-id="id"
    :session-key="sessionKey"
    embedded
    consultation-active
    @consultation-activity="emit('activity')"
  />
  <section v-else class="partner-consultation-panel">
    <div ref="thread" class="partner-consultation-thread">
      <div v-if="!messages.length && !draft" class="partner-consultation-empty">
        <PartnerAvatar :name="name" :emoji="emoji" :color="color" :image="avatar" :size="48" />
        <h2>{{ name }}</h2>
        <p>继续这段咨询。消息只属于当前伙伴会话。</p>
      </div>
      <article v-for="(message, index) in messages" :key="index" :class="message.role === 'user' ? 'partner-consultation-user' : 'partner-consultation-assistant'">
        <PartnerAvatar v-if="message.role !== 'user'" :name="message.author_name || name" :emoji="emoji" :color="color" :image="avatar" :size="24" />
        <div>
          <small v-if="message.author_name || message.role !== 'user'">{{ message.author_name || name }}</small>
          <MarkdownView :content="message.content" />
        </div>
      </article>
      <article v-if="draft" class="partner-consultation-assistant">
        <PartnerAvatar :name="name" :emoji="emoji" :color="color" :image="avatar" :size="24" />
        <div><small>{{ name }}</small><MarkdownView :content="draft" /></div>
      </article>
      <p v-if="error" class="partner-consultation-error" role="alert">{{ error }}</p>
    </div>
    <form
      class="partner-consultation-composer partner-consultation-composer-rich"
      :class="{ 'is-dragging': dragging }"
      @submit.prevent="send"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="dropFiles"
    >
      <input ref="fileInput" type="file" hidden multiple accept="image/*,.pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.json,.py,.js,.ts,.html,.css" @change="selectFiles">
      <div class="partner-consultation-toolbar">
        <button type="button" aria-label="附加文件" title="附加文件" :disabled="busy" @click="fileInput?.click()"><LegacyIcon name="attachment" :size="15" /></button>
        <span>{{ activeSessionKey || '新对话' }}</span>
        <button type="button" aria-label="归档当前对话" title="归档当前对话" :disabled="busy || !messages.length" @click="archiveCurrent"><LegacyIcon name="archive" :size="14" /></button>
      </div>
      <div v-if="attachments.length" class="partner-consultation-attachments">
        <span v-for="(attachment, index) in attachments" :key="`${attachment.filename}-${index}`">
          <img v-if="attachment.previewUrl" :src="attachment.previewUrl" :alt="attachment.filename">
          <LegacyIcon v-else name="attachment" :size="15" />
          <strong>{{ attachment.filename }}</strong>
          <button type="button" :aria-label="`移除附件 ${attachment.filename}`" @click="attachments.splice(index, 1)">×</button>
        </span>
      </div>
      <p v-if="attachmentError" class="partner-consultation-error" role="alert">{{ attachmentError }}</p>
      <div class="partner-consultation-input-row">
        <textarea v-model="input" rows="2" :disabled="busy" :placeholder="`继续与 ${name} 对话…`" @keydown.enter.exact.prevent="send" @paste="pasteFiles" />
        <button v-if="busy" type="button" class="is-stop" aria-label="停止" @click="stop">停止</button>
        <button v-else type="submit" :disabled="!canSend" aria-label="发送">发送</button>
      </div>
    </form>
  </section>
</template>
