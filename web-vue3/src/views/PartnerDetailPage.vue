<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'
import MarkdownView from '../components/MarkdownView.vue'
import PartnerAvatar from '../components/PartnerAvatar.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import PartnerLinkModal from '../components/PartnerLinkModal.vue'
import ConversationSaveDialog from '../components/ConversationSaveDialog.vue'
import PartnerConfigPanel from '../components/PartnerConfigPanel.vue'
import PartnerGroupDiscussion from '../components/PartnerGroupDiscussion.vue'
import type { GroupMessage } from '../groupDiscussion'

interface LLMSelection { profile_id: string; model_id: string }
interface Partner { partner_id: string; name: string; description?: string; emoji?: string; color?: string; avatar?: string; language?: string; running?: boolean; can_manage?: boolean; workspace_id?: string; llm_selection?: LLMSelection | null; backup_llm_selection?: LLMSelection | null; enabled_tools?: string[] | null; builtin_tools?: string[] | null; mcp_tools?: string[] | null; channels?: string[] | Record<string, unknown> }
interface Group { group_id: string; name: string; description?: string; emoji?: string; color?: string; member_ids: string[]; members?: Partner[]; discussion_mode?: string }
interface Session { session_key: string; title?: string; archived?: boolean; updated_at?: string; message_count?: number; last_message?: string; chat_id?: string; scope?: 'group' | 'direct' }
interface Mode { name: string; label: string; description: string }
interface Message { role: string; content: string; author_name?: string; timestamp?: string; created_at?: string }
interface PendingAttachment { type: 'image' | 'file'; filename: string; base64: string; previewUrl?: string; size: number; mimeType?: string }
const props = defineProps<{ kind: 'partner' | 'group' }>()
const route = useRoute()
const router = useRouter()
const id = computed(() => String(props.kind === 'partner' ? route.params.partnerId : route.params.groupId || ''))
const base = computed(() => props.kind === 'partner' ? `/api/partners/${encodeURIComponent(id.value)}` : `/api/partner-groups/${encodeURIComponent(id.value)}`)
const detail = ref<Partner | Group | null>(null)
const sessions = ref<Session[]>([])
const messages = ref<Message[]>([])
const sessionKey = ref('')
const input = ref('')
const editName = ref('')
const editDescription = ref('')
const editLanguage = ref('')
const editEmoji = ref('')
const editColor = ref('')
const editAvatar = ref('')
const faceFileInput = ref<HTMLInputElement | null>(null)
const faceError = ref('')
const FACE_EMOJIS = ['🦊','🐳','🦉','🐱','🐶','🐼','🐨','🦁','🐯','🐸','🐙','🦄','🤖','👾','🌱','🌸','🍀','🌙','✨','🔥','📚','🎨','🎧','🧭']
const PARTNER_COLORS = ['#b0501e','#8c6a2f','#4f7a5b','#3d6b8a','#6d5a8c','#8a4f5f','#a8763e','#5b8a8a']
const editing = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const editMemberIds = ref<string[]>([])
const editMode = ref('panel_parallel')
const partners = ref<Partner[]>([])
const modes = ref<Mode[]>([])
const draft = ref('')
const panelOpen = ref(false)
const panelTab = ref<'reasoning' | 'context'>('reasoning')
const sessionMenuOpen = ref(false)
const deleteArmed = ref(false)
const suggestionIndex = ref(0)
const whiteboard = ref<Record<string, unknown>[]>([])
type PartnerConfigTab = 'chat' | 'configure' | 'channels' | 'archive'
const configTab = ref<PartnerConfigTab>('chat')
const archiveKey = ref('')
const archiveMessages = ref<Message[]>([])
const archiveLoading = ref(false)
const continuityEnabled = ref(false)
const saveOpen = ref(false)
const linkOpen = ref(false)
const attachments = ref<PendingAttachment[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const attachmentError = ref('')
const composerDragging = ref(false)
const composerTips = ref(false)
const canSend = computed(() => Boolean(input.value.trim() || attachments.value.length) && !busy.value)
let groupRefreshTimer: ReturnType<typeof setInterval> | undefined
let streamAbort: AbortController | undefined
const partner = computed(() => props.kind === 'partner' ? detail.value as Partner | null : null)
const group = computed(() => props.kind === 'group' ? detail.value as Group | null : null)
const archiveSelected = computed(() => sessions.value.find(row => row.session_key === archiveKey.value) || null)
function archiveTitle(row: Session) {
  const title = (row.title || '').trim()
  return !title || title === 'New conversation' ? (row.archived ? '已归档对话' : '新对话') : title
}
function archiveTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
function archivePreview(content?: string) {
  if (!content) return ''
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, '')
    .replace(/\|/g, ' · ')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 160 ? `${plain.slice(0, 160).trimEnd()}…` : plain
}
const exportMessages = computed(() => configTab.value === 'archive' ? archiveMessages.value : messages.value)
const currentSession = computed(() => sessions.value.find(row => row.session_key === sessionKey.value))
const mentionQuery = computed(() => props.kind === 'group' ? input.value.match(/(?:^|\s)@([^\s@]*)$/)?.[1] : undefined)
const mentionSuggestions = computed(() => mentionQuery.value === undefined ? [] : (group.value?.members || []).filter(member => member.name.toLocaleLowerCase().includes(mentionQuery.value!.toLocaleLowerCase())))
const addressedMembers = computed(() => (group.value?.members || []).filter(member => input.value.includes(`@${member.name}`)))
const groupModeLabel = computed(() => modeLabel(group.value?.discussion_mode || 'panel_parallel'))
async function load() {
  if (!id.value) return
  error.value = ''
  try {
    detail.value = await api<Partner | Group>(base.value)
    editName.value = detail.value.name; editDescription.value = detail.value.description || ''; const partnerDetail = detail.value as Partner; editLanguage.value = partnerDetail.language || ''; editEmoji.value = partnerDetail.emoji || ''; editColor.value = partnerDetail.color || ''; editAvatar.value = partnerDetail.avatar || ''
    sessions.value = await api<Session[]>(`${base.value}/sessions`).catch(() => [])
    if (props.kind === 'group') {
      editMemberIds.value = [...(detail.value as Group).member_ids]
      editMode.value = String((detail.value as Group).discussion_mode || 'panel_parallel')
      const [roster, discussionModes] = await Promise.all([api<Partner[]>('/api/partners').catch(() => []), api<Mode[]>('/api/partner-groups/discussion-modes').catch(() => [])])
      partners.value = roster; modes.value = discussionModes
    }
    if (props.kind === 'group' && !sessionKey.value) sessionKey.value = 'default'
    if (props.kind === 'partner') {
      const continuity = await api<{ enabled: boolean; session_key: string | null }>(`${base.value}/web-continuity`).catch(() => null)
      continuityEnabled.value = Boolean(continuity?.enabled)
      if (!sessionKey.value) sessionKey.value = continuity?.session_key || sessions.value.find(row => !row.archived)?.session_key || sessions.value[0]?.session_key || ''
      if (!archiveKey.value) archiveKey.value = sessions.value[0]?.session_key || ''
    }
    await loadHistory()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '伙伴加载失败' }
}
function modeLabel(name: string) { return ({ panel_parallel: '并行回答', sequential: '依次补充', debate: '交叉辩论' } as Record<string, string>)[name] || name }
function modeHint(mode: Mode) { return mode.name === 'panel_parallel' ? '所有人同时独立回答同一个问题。' : mode.name === 'sequential' ? '每位伙伴都能看到前面说过的内容，在此之上补充。' : mode.name === 'debate' ? '先各自表明立场，再针对分歧互相回应。' : mode.description }
function modeCost(mode: Mode) { return mode.name === 'panel_parallel' ? '最快' : mode.name === 'sequential' ? '较慢 · 需要依次等待' : mode.name === 'debate' ? '两轮 · 等待约翻倍' : '' }
function selectSession(key: string) { sessionMenuOpen.value = false; messages.value = []; sessionKey.value = key; if (props.kind === 'group') void router.replace({ query: { session: key } }) }
function completeMention(member: Partner) { input.value = input.value.replace(/(?:^|\s)@([^\s@]*)$/, match => `${match.startsWith(' ') ? ' ' : ''}@${member.name} `); suggestionIndex.value = 0 }
function composerKeydown() { if (mentionSuggestions.value.length) { completeMention(mentionSuggestions.value[Math.min(suggestionIndex.value, mentionSuggestions.value.length - 1)]); return } void sendMessage() }
function downloadDiscussion() {
  if (!messages.value.length || !group.value) return
  const title = `${group.value.name} — ${currentSession.value?.title || '新讨论'}`
  const body = [`# ${title}`, '', ...messages.value.map(message => `## ${message.author_name || (message.role === 'user' ? '你' : group.value?.name || '伙伴')}\n\n${message.content}`)].join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title}.md`; anchor.click(); URL.revokeObjectURL(url)
}
async function loadWhiteboard() { if (props.kind !== 'group') return; try { const result = await api<Record<string, unknown>[] | { entries?: Record<string, unknown>[] }>(`${base.value}/whiteboard`); whiteboard.value = Array.isArray(result) ? result : result.entries || [] } catch { whiteboard.value = [] } }
watch([panelOpen, panelTab], ([open, tab]) => { if (open && tab === 'context') void loadWhiteboard() })
watch(mentionQuery, () => { suggestionIndex.value = 0 })
async function loadHistory() {
  if (!id.value || props.kind === 'group') return
  const params = new URLSearchParams({ limit: '200' })
  if (sessionKey.value) params.set('session_key', sessionKey.value)
  try { messages.value = await api<Message[]>(`${base.value}/history?${params}`) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '历史记录加载失败' }
}
function receiveGroupMessages(rows: GroupMessage[]) {
  messages.value = rows.map(row => ({
    role: row.role,
    content: row.content,
    author_name: row.author_name,
    created_at: row.created_at,
  }))
}
async function handleGroupDone() {
  sessions.value = await api<Session[]>(`${base.value}/sessions`).catch(() => sessions.value)
}
watch([id, () => props.kind], load, { immediate: true })
watch(sessionKey, loadHistory)
watch(archiveKey, async key => { if (!key || props.kind !== 'partner') { archiveMessages.value = []; return }; archiveLoading.value = true; try { archiveMessages.value = await api<Message[]>(`${base.value}/history?limit=100&session_key=${encodeURIComponent(key)}`) } catch { archiveMessages.value = [] } finally { archiveLoading.value = false } })
watch(configTab, tab => { if (tab === 'archive' && archiveKey.value) { const key = archiveKey.value; archiveKey.value = ''; archiveKey.value = key } })
async function toggleContinuity() { const enabled = !continuityEnabled.value; try { const result = await api<{ enabled: boolean; session_key: string | null }>(`${base.value}/web-continuity`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, session_key: sessionKey.value || null }) }); continuityEnabled.value = result.enabled; if (result.session_key) sessionKey.value = result.session_key } catch (cause) { error.value = cause instanceof Error ? cause.message : '浏览器同步设置失败' } }
async function archiveActiveConversation() {
  if (!messages.value.length || !sessionKey.value) return
  try { await post(`${base.value}/sessions/archive`, { session_key: sessionKey.value }); messages.value = []; sessions.value = await api<Session[]>(`${base.value}/sessions`); sessionKey.value = ''; await createSession(); notice.value = '对话已归档' } catch (cause) { error.value = cause instanceof Error ? cause.message : '归档失败' }
}
function downloadPartnerHistory() {
  if (!partner.value || !exportMessages.value.length) return
  const title = exportMessages.value.find(message => message.role === 'user')?.content.trim().slice(0, 80) || partner.value.name
  const body = [`# ${title}`, '', ...exportMessages.value.map(message => `## ${message.role === 'user' ? '你' : partner.value?.name || '伙伴'}\n\n${message.content}`)].join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title}.md`; anchor.click(); URL.revokeObjectURL(url)
}
function openSave() { saveOpen.value = true }
async function resumeArchived(row: Session) { await archiveSession(row); sessionKey.value = row.session_key; configTab.value = 'chat' }
async function deleteArchived(key: string) { if (!confirm('删除这条对话？')) return; await post(`${base.value}/sessions/delete`, { session_key: key }); sessions.value = await api<Session[]>(`${base.value}/sessions`); archiveKey.value = sessions.value[0]?.session_key || ''; notice.value = '对话已删除' }
async function handlePartnerCommand(content: string) {
  if (props.kind !== 'partner' || !content.startsWith('/')) return false
  const [command, ...rest] = content.split(/\s+/); const arg = rest.join(' ').trim()
  if (command === '/new' || command === '/clear') { if (command === '/clear' && messages.value.length) await archiveActiveConversation(); else await createSession(); return true }
  if (command === '/branch') { await branchSession(); return true }
  if (command === '/resume' && arg) { sessionKey.value = arg; return true }
  if (command === '/delete' && arg) { await post(`${base.value}/sessions/delete`, { session_key: arg }); sessions.value = await api<Session[]>(`${base.value}/sessions`); if (arg === sessionKey.value) { sessionKey.value = ''; messages.value = [] }; return true }
  if (command === '/sessions') { sessions.value = await api<Session[]>(`${base.value}/sessions`); messages.value = [...messages.value, { role: 'assistant', content: `对话：\n${sessions.value.slice(0, 30).map(row => `- \`${row.session_key}\`${row.archived ? '（已归档）' : ''} — ${row.title || '新对话'}`).join('\n')}\n\n使用 /resume <会话 ID> 或 /delete <会话 ID>。` }]; return true }
  return false
}
function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取附件失败'))
    reader.readAsDataURL(file)
  })
}
async function addFiles(files: File[]) {
  attachmentError.value = ''
  const accepted: PendingAttachment[] = []
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) { attachmentError.value = `文件过大：${file.name}`; continue }
    const raw = await readAsDataUrl(file)
    accepted.push({
      type: file.type.startsWith('image/') && file.type !== 'image/svg+xml' ? 'image' : 'file',
      filename: file.name,
      base64: raw.split(',')[1] || '',
      previewUrl: file.type.startsWith('image/') ? raw : undefined,
      size: file.size,
      mimeType: file.type || undefined,
    })
  }
  attachments.value = [...attachments.value, ...accepted].slice(0, 10)
}
async function onFileInput(event: Event) {
  const inputElement = event.target as HTMLInputElement
  await addFiles(Array.from(inputElement.files || []))
  inputElement.value = ''
}
async function onComposerPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => Boolean(file))
  if (!files.length) return
  event.preventDefault()
  await addFiles(files)
}
async function onComposerDrop(event: DragEvent) {
  composerDragging.value = false
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) await addFiles(files)
}
function removeAttachment(index: number) { attachments.value = attachments.value.filter((_, itemIndex) => itemIndex !== index) }
function stopStream() { streamAbort?.abort(); streamAbort = undefined; busy.value = false; draft.value = '' }
async function sendMessage() {
  const content = input.value.trim()
  const pending = [...attachments.value]
  if (content === '/stop' && props.kind === 'partner') { stopStream(); input.value = ''; return }
  if ((!content && !pending.length) || busy.value) return
  if (!pending.length && await handlePartnerCommand(content)) { input.value = ''; return }
  const visibleContent = content || (pending.every(item => item.type === 'image') ? '请分析所附图片。' : '请使用所附文件。')
  busy.value = true; error.value = ''; draft.value = ''
  try {
    if (props.kind === 'partner') {
      await streamPartnerMessage(visibleContent, pending)
    } else {
      await post(`${base.value}/messages`, { content: visibleContent, session_key: sessionKey.value, attachments: pending.map(item => ({ type: item.type, filename: item.filename, base64: item.base64, mime_type: item.mimeType })) })
      scheduleGroupRefresh()
    }
    input.value = ''
    attachments.value = []
    sessions.value = await api<Session[]>(`${base.value}/sessions`).catch(() => sessions.value)
    if (props.kind === 'partner' && !sessionKey.value && sessions.value[0]) sessionKey.value = sessions.value[0].session_key
    await loadHistory()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '发送失败' }
  finally { busy.value = false; draft.value = ''; streamAbort = undefined }
}
async function streamPartnerMessage(content: string, pending: PendingAttachment[] = []) {
  streamAbort = new AbortController()
  const response = await fetch(scopedUrl(`${base.value}/chat/execute-stream`), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, ...(sessionKey.value ? { session_key: sessionKey.value } : {}), attachments: pending.map(item => ({ type: item.type, filename: item.filename, base64: item.base64, mime_type: item.mimeType })) }), signal: streamAbort.signal })
  if (!response.ok || !response.body) { const body = await response.json().catch(() => ({})); throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`) }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const process = (block: string) => {
    let eventName = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (!data.length) return
    const raw = data.join('\n')
    try { const payload = JSON.parse(raw); if (eventName === 'content') draft.value = String(payload.content ?? payload ?? ''); else if (eventName === 'error') error.value = String(payload.detail || payload.content || '伙伴回复失败') }
    catch { if (eventName === 'content') draft.value = raw }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''
    for (const block of blocks) process(block)
  }
  buffer += decoder.decode()
  if (buffer.trim()) process(buffer)
}
function scheduleGroupRefresh() {
  if (groupRefreshTimer) clearInterval(groupRefreshTimer)
  let remaining = 5
  groupRefreshTimer = setInterval(async () => { await loadHistory(); if (--remaining <= 0 && groupRefreshTimer) { clearInterval(groupRefreshTimer); groupRefreshTimer = undefined } }, 1500)
}
onBeforeUnmount(() => { if (groupRefreshTimer) clearInterval(groupRefreshTimer) } )
function chooseFaceEmoji(emoji: string) {
  editAvatar.value = ''
  editEmoji.value = editEmoji.value === emoji ? '' : emoji
}
function chooseFaceColor(color: string) {
  editColor.value = editColor.value === color ? '' : color
}
async function onFaceFile(event: Event) {
  const inputElement = event.target as HTMLInputElement
  const file = inputElement.files?.[0]
  inputElement.value = ''
  faceError.value = ''
  if (!file) return
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.type)) {
    faceError.value = '请使用 PNG、JPG、WebP、GIF 或 SVG 图片。'
    return
  }
  if (file.size > 10 * 1024 * 1024) { faceError.value = '图片文件过大。'; return }
  const reader = new FileReader()
  reader.onload = () => { editAvatar.value = String(reader.result || '') }
  reader.onerror = () => { faceError.value = '无法读取这张图片。' }
  reader.readAsDataURL(file)
}
async function save() {
  if (!detail.value || !editName.value.trim()) return
  busy.value = true; error.value = ''
  try {
    detail.value = await api<Partner | Group>(base.value, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props.kind === 'group' ? { name: editName.value.trim(), description: editDescription.value, member_ids: editMemberIds.value, discussion_mode: editMode.value } : { name: editName.value.trim(), description: editDescription.value, language: editLanguage.value, emoji: editEmoji.value, color: editColor.value, avatar: editAvatar.value }) })
    editing.value = false; notice.value = '已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
async function lifecycle(action: 'start' | 'stop') {
  busy.value = true; error.value = ''
  try { await post(`${base.value}/${action}`, {}); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { busy.value = false }
}
async function remove() {
  if (!detail.value || (props.kind === 'partner' && !confirm(`删除“${detail.value.name}”？`))) return
  busy.value = true; error.value = ''
  try { await api(base.value, { method: 'DELETE' }); await router.push('/partners') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busy.value = false }
}
async function branchSession() {
  if (props.kind !== 'partner' || !sessionKey.value) return
  busy.value = true
  try { const result = await post<{ active_session_key?: string; session: Session }>(`${base.value}/sessions/branch`, { source_key: sessionKey.value, new_key: `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }); sessionKey.value = result.active_session_key || result.session.session_key; sessions.value = await api<Session[]>(`${base.value}/sessions`); notice.value = '已创建会话分支' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '创建分支失败' }
  finally { busy.value = false }
}
async function deleteSession(key = sessionKey.value) {
  if (!key || (props.kind === 'partner' && !confirm('删除当前会话？'))) return
  busy.value = true
  try {
    if (props.kind === 'partner') await post(`${base.value}/sessions/delete`, { session_key: key })
    else await api(`${base.value}/sessions/${encodeURIComponent(key)}`, { method: 'DELETE' })
    sessionKey.value = props.kind === 'group' && key !== sessionKey.value ? sessionKey.value : ''
    messages.value = []
    sessions.value = await api<Session[]>(`${base.value}/sessions`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除会话失败' }
  finally { busy.value = false }
}
async function createSession() {
  if (props.kind !== 'group') { sessionKey.value = ''; messages.value = []; return }
  busy.value = true; error.value = ''
  try {
    const result = await post<Session>(`${base.value}/sessions`, {})
    sessionKey.value = result.session_key
    sessions.value = await api<Session[]>(`${base.value}/sessions`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '新建会话失败' }
  finally { busy.value = false }
}
async function archiveSession(row: Session) {
  if (props.kind !== 'partner') return
  busy.value = true; error.value = ''
  try { await post(`${base.value}/sessions/${row.archived ? 'resume' : 'archive'}`, { session_key: row.session_key }); sessions.value = await api<Session[]>(`${base.value}/sessions`) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '会话操作失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main v-if="kind === 'group'" class="partner-group-detail">
    <template v-if="group">
      <header class="group-detail-header"><div class="group-detail-identity"><RouterLink to="/partners" aria-label="返回伙伴">←</RouterLink><PartnerAvatar :name="group.name" :emoji="group.emoji || '👥'" :color="group.color || '#8c6a2f'" :size="36" /><div><h1>{{ group.name }}</h1><p>{{ group.member_ids.length }} 位伙伴 <span>·</span> {{ groupModeLabel }} <span class="group-header-members"><PartnerAvatar v-for="member in (group?.members || []).slice(0, 5)" :key="member.partner_id" :name="member.name" :emoji="member.emoji" :color="member.color" :image="member.avatar" :size="18" /></span></p></div></div><div class="group-detail-actions"><div class="group-session-picker"><button class="group-tool-button" aria-haspopup="menu" :aria-expanded="sessionMenuOpen" @click="sessionMenuOpen = !sessionMenuOpen" @keydown.esc="sessionMenuOpen = false"><LegacyIcon name="chat" :size="12" /><span>{{ currentSession?.title || '新讨论' }}</span><LegacyIcon name="chevronDown" :size="11" /></button><div v-if="sessionMenuOpen" class="group-session-dismiss" @click="sessionMenuOpen = false"></div><div v-if="sessionMenuOpen" class="group-session-menu" role="menu" @keydown.esc="sessionMenuOpen = false"><button role="menuitem" @click="createSession(); sessionMenuOpen = false">＋ 新讨论</button><div v-if="sessions.length" class="group-session-divider" /><div v-for="row in sessions" :key="row.session_key" class="group-session-row"><button role="menuitem" @click="selectSession(row.session_key)"><span>{{ row.session_key === sessionKey ? '✓' : '' }}</span>{{ row.title || '新讨论' }}</button><button :aria-label="`删除讨论 ${row.title || row.session_key}`" @click="deleteSession(row.session_key)">×</button></div></div></div><button class="group-tool-button" :disabled="!messages.length" @click="downloadDiscussion"><LegacyIcon name="save" :size="12" />下载</button><button class="group-tool-button" :class="{ active: panelOpen }" @click="panelOpen = !panelOpen"><LegacyIcon name="resources" :size="12" />详情</button><button class="group-tool-button" @click="editing = true; deleteArmed = false"><LegacyIcon name="edit" :size="12" />管理</button></div></header>
<p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice">{{ notice }}</p>
      <PartnerGroupDiscussion
        v-model:panel-open="panelOpen"
        :group-id="id"
        :session-key="sessionKey"
        :initial-group="group"
        @messages-change="receiveGroupMessages"
        @done="handleGroupDone"
      />
      <div v-if="editing" class="group-manage-overlay" @click.self="editing = false"><form class="partner-edit group-manage-dialog" role="dialog" aria-modal="true" aria-label="管理伙伴群组" @submit.prevent="save"><header><h2>管理伙伴群组</h2><button type="button" aria-label="关闭" @click="editing = false">×</button></header><label>名称<input v-model="editName" required></label><label>描述<textarea v-model="editDescription" rows="2" /></label><fieldset v-if="modes.length > 1"><legend>讨论方式</legend><div class="group-manage-modes"><button v-for="mode in modes" :key="mode.name" type="button" :class="{ active: editMode === mode.name }" :aria-pressed="editMode === mode.name" @click="editMode = mode.name"><i class="group-mode-radio"><LegacyIcon v-if="editMode === mode.name" name="check" :size="10" /></i><span><strong>{{ modeLabel(mode.name) }}<em v-if="modeCost(mode)">{{ modeCost(mode) }}</em></strong><small>{{ modeHint(mode) }}</small></span></button></div><select v-model="editMode" aria-label="讨论方式" class="legacy-sr-only" aria-hidden="true" tabindex="-1"><option v-for="mode in modes" :key="mode.name" :value="mode.name">{{ modeLabel(mode.name) }}</option></select></fieldset><div class="group-manage-member-heading"><span>成员</span><small>已选择 {{ editMemberIds.length }} 项 · 至少 2 位</small></div><div class="group-manage-members"><button v-for="member in partners" :key="member.partner_id" type="button" :class="{ active: editMemberIds.includes(member.partner_id) }" @click="editMemberIds.includes(member.partner_id) ? editMemberIds = editMemberIds.filter(id => id !== member.partner_id) : editMemberIds.push(member.partner_id)"><PartnerAvatar :name="member.name" :emoji="member.emoji" :color="member.color" :image="member.avatar" :size="26" /><span>{{ member.name }}</span></button></div><div class="legacy-sr-only" aria-hidden="true"><label v-for="member in partners" :key="`compat-${member.partner_id}`"><input v-model="editMemberIds" type="checkbox" :value="member.partner_id" tabindex="-1">{{ member.name }}</label></div><footer><div><button v-if="!deleteArmed" type="button" class="group-delete" @click="deleteArmed = true">⌫ 删除群组</button><template v-else><button type="button" class="group-delete-confirm" @click="remove">永久删除</button><button type="button" @click="deleteArmed = false">取消</button></template></div><button class="primary" :disabled="busy || !editName.trim() || editMemberIds.length < 2">{{ busy ? '保存中…' : '保存' }}</button></footer></form></div>
    </template><div v-else class="group-detail-missing"><p>{{ error || '未找到伙伴群组' }}</p><RouterLink to="/partners">返回伙伴</RouterLink></div>
  </main>
  <main v-else class="partner-direct-detail"><template v-if="partner"><header class="partner-direct-header"><div class="partner-page-crumb"><RouterLink class="partner-crumb-root" to="/partners"><LegacyIcon name="chat" :size="14" /><span>伙伴</span></RouterLink><span class="partner-crumb-separator" aria-hidden="true">/</span><RouterLink class="partner-crumb-current" :to="`/partners/${encodeURIComponent(id)}`"><PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="20" /><strong>{{ partner.name }}</strong><span class="partner-runtime-dot" :class="{ running: partner.running }" role="img" :aria-label="partner.running ? '运行中' : '已停止'" /></RouterLink></div><nav class="partner-direct-tabs" role="tablist" :aria-label="partner.name"><button role="tab" :aria-selected="configTab === 'chat'" :class="{ active: configTab === 'chat' }" @click="configTab = 'chat'"><LegacyIcon name="chat" :size="14" :stroke-width="1.7" />聊天</button><button v-if="partner.can_manage" role="tab" :aria-selected="configTab === 'configure'" :class="{ active: configTab === 'configure' }" @click="configTab = 'configure'"><LegacyIcon name="settings" :size="14" :stroke-width="1.7" />配置</button><button v-if="partner.can_manage" role="tab" :aria-selected="configTab === 'channels'" :class="{ active: configTab === 'channels' }" @click="configTab = 'channels'"><LegacyIcon name="radio" :size="14" :stroke-width="1.7" />频道</button><button role="tab" :aria-selected="configTab === 'archive'" :class="{ active: configTab === 'archive' }" @click="configTab = 'archive'"><LegacyIcon name="archive" :size="14" :stroke-width="1.7" />历史记录</button></nav><div class="partner-direct-actions"><button type="button" class="partner-sync-button" :aria-pressed="continuityEnabled" aria-label="跨浏览器同步" :disabled="busy || configTab !== 'chat'" @click="toggleContinuity"><LegacyIcon name="monitorSmartphone" :size="15" /><span>跨浏览器同步</span></button><span class="partner-action-divider" aria-hidden="true" /><button v-if="configTab === 'chat'" title="归档" aria-label="归档" :disabled="!messages.length" @click="archiveActiveConversation"><LegacyIcon name="archive" :size="16" /></button><button v-if="configTab === 'chat' || configTab === 'archive'" title="保存到收藏夹" aria-label="保存到收藏夹" :disabled="!exportMessages.length" @click="openSave"><LegacyIcon name="bookmarkPlus" :size="16" /></button><button v-if="configTab === 'chat' || configTab === 'archive'" title="下载 Markdown" aria-label="下载 Markdown" :disabled="!exportMessages.length" @click="downloadPartnerHistory"><LegacyIcon name="fileDown" :size="16" /></button><button title="链接聊天账号" aria-label="链接聊天账号" @click="linkOpen = true"><LegacyIcon name="link" :size="16" /></button><template v-if="partner.can_manage"><button :aria-label="partner.running ? '停止伙伴' : '启动伙伴'" :title="partner.running ? '停止伙伴' : '启动伙伴'" :disabled="busy" @click="lifecycle(partner.running ? 'stop' : 'start')"><LegacyIcon :name="partner.running ? 'stop' : 'play'" :size="16" /></button><button class="danger" aria-label="删除伙伴" title="删除伙伴" @click="remove"><LegacyIcon name="trash" :size="16" /></button></template></div></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice">{{ notice }}</p><section v-if="configTab === 'chat'" class="partner-direct-chat"><div class="partner-direct-messages"><div v-if="!messages.length && !draft" class="partner-direct-empty"><PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="56" /><h2>{{ partner.name }}</h2><p>打个招呼吧——频道不是必需的，所有已连接的频道都会共享这位伙伴的记忆。</p></div><div v-else class="partner-direct-message-column"><article v-for="(message, index) in messages" :key="index" :class="message.role === 'user' ? 'partner-user-message' : 'partner-assistant-message'"><PartnerAvatar v-if="message.role !== 'user'" :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="26" /><div><MarkdownView :content="message.content" /></div></article><article v-if="draft" class="partner-assistant-message"><PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="26" /><div><MarkdownView :content="draft" /></div></article></div></div><form class="partner-composer partner-direct-composer" @submit.prevent="sendMessage" @dragenter.prevent="composerDragging = true" @dragover.prevent="composerDragging = true" @dragleave.prevent="composerDragging = false" @drop.prevent="onComposerDrop"><input ref="fileInput" type="file" multiple hidden accept="image/*,.pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.json,.py,.js,.ts,.html,.css" @change="onFileInput"><div v-if="composerDragging" class="partner-composer-drop"><LegacyIcon name="attachment" :size="20" :stroke-width="1.7" /><strong>拖放文件到这里</strong><span>图片、Office 文档、代码与文本</span></div><textarea v-model="input" rows="1" maxlength="32000" aria-label="输入消息" placeholder="输入消息…" :disabled="busy" @keydown.enter.exact.prevent="sendMessage" @paste="onComposerPaste" /><div v-if="attachments.length" class="partner-pending-attachments"><div v-for="(attachment, index) in attachments" :key="`${attachment.filename}-${index}`" class="partner-pending-attachment"><img v-if="attachment.previewUrl" :src="attachment.previewUrl" :alt="attachment.filename" /><LegacyIcon v-else name="attachment" :size="18" :stroke-width="1.6" /><span>{{ attachment.filename }}</span><button type="button" aria-label="移除附件" @click="removeAttachment(index)"><LegacyIcon name="close" :size="11" /></button></div></div><p v-if="attachmentError" class="partner-composer-error" role="alert">{{ attachmentError }}</p><div class="partner-composer-controls"><div class="partner-composer-tools"><button type="button" aria-label="附加文件" title="附加文件" :disabled="busy" @click="fileInput?.click()"><LegacyIcon name="attachment" :size="16" :stroke-width="1.9" /></button><div class="partner-composer-tips" @mouseenter="composerTips = true" @mouseleave="composerTips = false"><button type="button" aria-label="提示" title="提示"><LegacyIcon name="info" :size="16" :stroke-width="1.9" /></button><div v-if="composerTips" class="partner-composer-tip-panel"><strong>提示</strong><p>输入 / 查看命令，可新建对话、查看历史、切换工具等。</p><p>使用回形针添加图片或文档，也可以直接拖入。</p></div></div></div><button v-if="busy" type="button" class="partner-composer-send is-stop" aria-label="停止回复" title="停止" @click="stopStream"><LegacyIcon name="stop" :size="12" /></button><button v-else type="button" class="partner-composer-send" aria-label="发送" title="发送" :disabled="!canSend" @click="sendMessage"><LegacyIcon name="arrowUp" :size="16" :stroke-width="2.2" /></button></div></form></section><section v-else-if="configTab === 'configure' && partner.can_manage" class="partner-direct-config"><form class="partner-identity-section partner-config-section" @submit.prevent="save"><header><div><h3>身份</h3></div><button class="primary" :disabled="busy || !editName.trim()"><LegacyIcon name="save" :size="14" :stroke-width="1.7" />保存</button></header><div class="partner-identity-fields"><label>名称<input v-model="editName" required></label><label>回复语言<select v-model="editLanguage"><option value="">自动（英语）</option><option value="en">English</option><option value="zh">中文</option></select></label><label class="is-wide">简介<input v-model="editDescription"></label></div><div class="partner-face-editor"><span class="partner-face-label">形象</span><PartnerAvatar :name="editName || '?'" :emoji="editEmoji" :color="editColor" :image="editAvatar" :size="88" /><div class="partner-face-emojis"><button v-for="emoji in FACE_EMOJIS" :key="emoji" type="button" :class="{ active: !editAvatar && editEmoji === emoji }" @click="chooseFaceEmoji(emoji)">{{ emoji }}</button></div><div class="partner-face-colors" :class="{ disabled: Boolean(editAvatar) }"><button v-for="color in PARTNER_COLORS" :key="color" type="button" :aria-label="color" :style="{ background: color }" @click="chooseFaceColor(color)"><span v-if="editColor === color" /></button></div><div class="partner-face-actions"><input ref="faceFileInput" type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" @change="onFaceFile"><button type="button" class="partner-face-upload" @click="faceFileInput?.click()"><LegacyIcon name="image" :size="14" />{{ editAvatar ? '替换图片' : '上传图片 / SVG' }}</button><button v-if="editAvatar" type="button" class="partner-face-remove" @click="editAvatar = ''">移除</button></div><p v-if="faceError" class="partner-face-error" role="alert">{{ faceError }}</p></div></form><PartnerConfigPanel :key="'configure-soul'" :partner-id="id" section="soul" :llm-selection="partner.llm_selection || null" :backup-llm-selection="partner.backup_llm_selection || null" @notice="notice = $event" @error="error = $event" @updated="load" :initial-enabled-tools="partner.enabled_tools" :initial-builtin-tools="partner.builtin_tools" :initial-mcp-tools="partner.mcp_tools" /><PartnerConfigPanel :partner-id="id" section="assets" :workspace-id="partner.workspace_id || ''" @notice="notice = $event" @error="error = $event" @updated="load" /></section><section v-else-if="configTab === 'channels' && partner.can_manage" class="partner-direct-config"><PartnerConfigPanel :key="'channels'" :partner-id="id" section="channels" @notice="notice = $event" @error="error = $event" /></section><section v-else class="partner-archive-layout"><aside class="partner-archive-list"><header><div><h2>聊天</h2><p>{{ sessions.length ? `${sessions.length} 个会话` : '暂无会话' }}</p></div><button aria-label="刷新" title="刷新" :disabled="busy" @click="load"><LegacyIcon name="refreshCw" :size="14" :stroke-width="1.7" /></button></header><div class="partner-archive-sessions"><button v-for="row in sessions" :key="row.session_key" class="partner-archive-session" :class="{ active: archiveKey === row.session_key }" @click="archiveKey = row.session_key"><div class="partner-archive-session-title"><LegacyIcon :name="row.archived ? 'archive' : 'chat'" :size="14" :stroke-width="1.7" /><span>{{ archiveTitle(row) }}</span><b>{{ row.message_count ?? 0 }}</b></div><p v-if="row.last_message">{{ archivePreview(row.last_message) }}</p><div class="partner-archive-session-meta"><span><LegacyIcon name="clock" :size="12" />{{ archiveTime(row.updated_at) }}</span><span v-if="row.chat_id" :title="row.chat_id"><LegacyIcon :name="row.scope === 'group' ? 'partners' : 'profile'" :size="12" />{{ row.chat_id }}</span></div></button><div v-if="!sessions.length" class="partner-archive-empty">暂无对话</div></div></aside><div class="partner-archive-content"><template v-if="archiveSelected"><header class="partner-archive-detail-head"><div><h3>{{ archiveTitle(archiveSelected) }}</h3><p>{{ archiveSelected.archived ? '已归档 · ' : '' }}{{ archiveTime(archiveSelected.updated_at) }}</p></div><div class="partner-archive-detail-actions"><span>{{ archiveSelected.message_count ?? archiveMessages.length }} 条消息</span><button class="partner-archive-continue" @click="resumeArchived(archiveSelected)"><LegacyIcon name="rotateCcw" :size="12" :stroke-width="1.7" />继续</button><button class="partner-archive-delete" aria-label="删除对话" title="删除对话" @click="deleteArchived(archiveKey)"><LegacyIcon name="trash" :size="14" /></button></div></header><div class="partner-archive-messages"><p v-if="archiveLoading" class="partner-archive-loading">加载中...</p><div v-for="(message, index) in archiveMessages" v-else :key="index" class="partner-archive-message" :class="message.role === 'user' ? 'is-user' : 'is-assistant'"><div><MarkdownView v-if="message.role === 'assistant'" :content="message.content" /><template v-else>{{ message.content }}</template></div></div></div></template><div v-else class="partner-archive-select">选择对话</div></div></section><ConversationSaveDialog v-if="saveOpen" :messages="exportMessages" record-type="tutorbot" :metadata="{ source: 'partner', partner_id: id, partner_name: partner.name }" :fallback-title="partner.name" @close="saveOpen = false" @saved="saveOpen = false; notice = '已保存到收藏夹'" /><PartnerLinkModal v-if="linkOpen" :partner-id="id" :partner-name="partner.name" @close="linkOpen = false" /></template><div v-else class="group-detail-missing"><p>{{ error || '未找到伙伴' }}</p><RouterLink to="/partners">返回伙伴</RouterLink></div></main>
</template>
