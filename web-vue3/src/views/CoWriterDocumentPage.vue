<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { api, ApiError, authStatus } from '../api'
import { activeWorkspaceId, scopedUrl } from '../workspaceScope'
import RichNoteEditor from '../components/RichNoteEditor.vue'
import MarkdownView from '../components/MarkdownView.vue'
import { blocksToHtml } from '../notes/noteBlocks'
import ChatPage from './ChatPage.vue'
import LearningBlocks from '../components/LearningBlocks.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import NotePageTree from '../components/NotePageTree.vue'
import NoteTopBar from '../components/NoteTopBar.vue'
import NotePageHead from '../components/NotePageHead.vue'
import NoteOutline from '../components/NoteOutline.vue'
import NoteFavoritesPicker from '../components/NoteFavoritesPicker.vue'
import NoteClipBlocks from '../components/NoteClipBlocks.vue'
import type { FavoriteItem, NoteBlock, NoteMetadataPatch, NotePage, NoteSummary } from '../notes/noteTypes'

interface Draft { title: string; content: string; blocks: NoteBlock[] | null; revision: number }
interface Suggestion { id: string; operation: string; markdown: string; explanation: string; status: string }
interface Thread { session_id: string; block_id: string; quote: string; origin: 'ask' | 'generate'; title: string; status: string; last_message?: string }

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.docId || ''))
const page = ref<NotePage | null>(null)
const title = ref('')
const content = ref('')
const blocks = ref<NoteBlock[]>([])
const pages = ref<NoteSummary[]>([])
const backlinks = ref<NoteSummary[]>([])
const suggestions = ref<Suggestion[]>([])
const threads = ref<Thread[]>([])
const assistantOpen = ref(false)
const favoritesOpen = ref(false)
const companionPrompt = ref('')
const chatRef = ref<InstanceType<typeof ChatPage> | null>(null)
const threadListOpen = ref(false)
const makeKind = ref('')
const generationBlockId = ref('')
const makeKinds = [
  { kind: 'diagram', label: '图解', icon: 'resources' },
  { kind: 'timeline', label: '时间线', icon: 'history' },
  { kind: 'concept_map', label: '概念图', icon: 'knowledge' },
  { kind: 'quiz', label: '测一测', icon: 'questions' },
  { kind: 'flashcards', label: '闪卡', icon: 'learning' },
  { kind: 'image', label: '生成图片', icon: 'image' },
]
const quickStarters = [
  { label: '从这里继续写', icon: 'edit', prompt: '从这里继续写，保持本页的语气与结构。' },
  { label: '解释这部分', icon: 'info', prompt: '解释这部分内容，说明关键概念和它们之间的关系。' },
  { label: '核对事实', icon: 'check', prompt: '核对这部分的事实，指出需要验证或可能不准确的地方。' },
  { label: '总结这一页', icon: 'menu', prompt: '总结这一页，提炼最重要的内容。' },
]
const activeBlockId = ref('')
const pendingAnchor = ref<{ blockId: string; quote: string; origin: 'ask' | 'generate' } | null>(null)
const status = ref('')
const error = ref('')
const busy = ref(false)
const mutating = ref(false)
const dirty = ref(false)
const conflict = ref(false)
const draftKey = ref('')
const recovery = ref<Draft | null>(null)
const editorEpoch = ref(0)
const richEditor = ref<InstanceType<typeof RichNoteEditor> | null>(null)
const showEditor = ref(true)
const showPreview = ref(true)
const editorRatio = ref(0.5)
const syncScrollEnabled = ref(true)
const splitContainer = ref<HTMLElement | null>(null)
const editorPane = ref<HTMLElement | null>(null)
const previewPane = ref<HTMLElement | null>(null)
const previewContent = computed(() => canEditContent.value ? content.value || '_暂无预览内容_' : blocksToHtml(blocks.value) || '_暂无预览内容_')
let syncingScroll = false
let stopResize: (() => void) | undefined
function synchronizePanes(source: 'editor' | 'preview', event: Event) {
  if (!syncScrollEnabled.value || !showEditor.value || !showPreview.value || syncingScroll) return
  const origin = event.target as HTMLElement
  const target = source === 'editor' ? previewPane.value : editorPane.value
  if (!target || origin === target) return
  const originRange = Math.max(1, origin.scrollHeight - origin.clientHeight)
  const targetRange = Math.max(0, target.scrollHeight - target.clientHeight)
  syncingScroll = true
  target.scrollTop = (origin.scrollTop / originRange) * targetRange
  requestAnimationFrame(() => { syncingScroll = false })
}
function startResize(event: PointerEvent) {
  if (!showEditor.value || !showPreview.value || !splitContainer.value) return
  event.preventDefault()
  const container = splitContainer.value
  const move = (next: PointerEvent) => {
    const rect = container.getBoundingClientRect()
    if (rect.width > 0) editorRatio.value = Math.min(0.82, Math.max(0.18, (next.clientX - rect.left) / rect.width))
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    stopResize = undefined
  }
  stopResize = stop
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
function resizeWithKeyboard(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    editorRatio.value = Math.min(0.82, Math.max(0.18, editorRatio.value + (event.key === 'ArrowLeft' ? -0.05 : 0.05)))
  } else if (event.key === 'Home') { event.preventDefault(); editorRatio.value = 0.5 }
}
const treeOpen = ref(false)
const outlineOpen = ref(true)
const mainElement = ref<HTMLElement | null>(null)
const margin = ref<'wide' | 'rail' | 'none'>('none')
let owner = 'local'
let editVersion = 0
let saveTimer: ReturnType<typeof setTimeout> | undefined
let loadVersion = 0
let resizeObserver: ResizeObserver | undefined
const canEditContent = computed(() => page.value?.blocks === null)
const invalidParents = computed(() => {
  const descendants = new Set<string>([id.value])
  let changed = true
  while (changed) {
    changed = false
    for (const item of pages.value) {
      if (item.parent_id && descendants.has(item.parent_id) && !descendants.has(item.id)) {
        descendants.add(item.id)
        changed = true
      }
    }
  }
  return descendants
})

async function loadPages() {
  try { pages.value = (await api<{ documents: NoteSummary[] }>('/api/documents')).documents }
  catch { /* The current page remains usable if the switcher cannot refresh. */ }
}
async function loadThreads() {
  try { threads.value = (await api<{ threads: Thread[] }>(`/api/documents/${encodeURIComponent(id.value)}/threads`)).threads }
  catch { threads.value = [] }
}
async function loadSuggestions() {
  try { suggestions.value = (await api<{ suggestions: Suggestion[] }>(`/api/documents/${encodeURIComponent(id.value)}/suggestions`)).suggestions.filter(item => item.status === 'pending') }
  catch { suggestions.value = [] }
}
async function loadBacklinks() {
  try { backlinks.value = (await api<{ pages: NoteSummary[] }>(`/api/documents/${encodeURIComponent(id.value)}/backlinks`)).pages }
  catch { backlinks.value = [] }
}
async function load() {
  const at = ++loadVersion
  error.value = ''
  status.value = '正在加载…'
  conflict.value = false
  try {
    const [document, listing, auth] = await Promise.all([
      api<NotePage>(`/api/documents/${encodeURIComponent(id.value)}`),
      api<{ documents: NoteSummary[] }>('/api/documents'),
      authStatus(),
    ])
    if (at !== loadVersion) return
    owner = auth.user_id || 'local'
    page.value = document
    title.value = document.title
    content.value = document.content
    blocks.value = structuredClone(document.blocks || [])
    pages.value = listing.documents
    editorEpoch.value++
    activeBlockId.value = blocks.value[0]?.id || ''
    dirty.value = false
    editVersion = 0
    status.value = '已保存'
    pendingAnchor.value = null
    assistantOpen.value = Boolean(route.query.chat)
    draftKey.value = `deeptutor.notes.vue.draft:${owner}:${activeWorkspaceId()}:${id.value}`
    treeOpen.value = localStorage.getItem(`deeptutor.notes.tree:${owner}`) === 'true'
    outlineOpen.value = localStorage.getItem(`deeptutor.notes.outline:${owner}`) !== 'false'
    recovery.value = null
    try {
      const raw = localStorage.getItem(draftKey.value)
      if (raw) {
        const candidate = JSON.parse(raw) as Draft | null
        if (candidate && candidate.revision === document.revision) {
          title.value = candidate.title
          content.value = candidate.content
          blocks.value = candidate.blocks || []
          page.value = { ...document, title: candidate.title }
          editVersion++
          dirty.value = true
          status.value = '已恢复未保存草稿'
          scheduleSave()
        } else if (candidate) recovery.value = candidate
      }
    } catch { /* Invalid or inaccessible local draft. */ }
    await Promise.all([loadSuggestions(), loadThreads(), loadBacklinks()])
  } catch (cause) {
    if (at !== loadVersion) return
    error.value = cause instanceof Error ? cause.message : '文档加载失败'
    status.value = ''
  }
}
watch(id, load, { immediate: true })
watch(mainElement, element => {
  resizeObserver?.disconnect()
  stopResize?.()
  if (!element) return
  resizeObserver = new ResizeObserver(([entry]) => {
    const spare = (entry.contentRect.width - 820) / 2
    margin.value = spare >= 212 ? 'wide' : spare >= 52 ? 'rail' : 'none'
  })
  resizeObserver.observe(element)
}, { immediate: true })

function setTreeOpen(open: boolean) {
  treeOpen.value = open
  try { localStorage.setItem(`deeptutor.notes.tree:${owner}`, String(open)) } catch { /* Optional preference. */ }
}
function setOutlineOpen(open: boolean) {
  outlineOpen.value = open
  try { localStorage.setItem(`deeptutor.notes.outline:${owner}`, String(open)) } catch { /* Optional preference. */ }
}
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void save() }, 900)
}
function persistDraft() {
  if (!page.value || !draftKey.value) return
  try {
    localStorage.setItem(draftKey.value, JSON.stringify({
      title: title.value,
      content: content.value,
      blocks: page.value.blocks === null ? null : blocks.value,
      revision: page.value.revision,
    }))
  } catch { /* Local storage can be unavailable. */ }
}
function changed() {
  editVersion++
  dirty.value = true
  status.value = '有未保存的更改'
  persistDraft()
  scheduleSave()
}
function updateTitle(value: string) {
  title.value = value
  if (page.value) page.value = { ...page.value, title: value }
  changed()
}
async function uploadAsset(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !page.value || page.value.blocks === null) return
  busy.value = true
  error.value = ''
  try {
    const body = new FormData()
    body.append('file', file)
    const response = await fetch(scopedUrl(`/api/documents/${encodeURIComponent(id.value)}/assets`), { method: 'POST', credentials: 'include', body })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `上传失败：HTTP ${response.status}`)
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'file'
    const block: NoteBlock = {
      id: crypto.randomUUID(), type,
      props: { url: String(result.url || ''), name: file.name, caption: file.name },
      content: [], children: [],
    }
    if (richEditor.value) richEditor.value.insertBlock(block)
    else blocks.value.push(block)
    changed()
    status.value = '附件已上传，正在保存…'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '附件上传失败' }
  finally { busy.value = false }
}
async function save() {
  if (!page.value || busy.value || !dirty.value) return
  if (saveTimer) clearTimeout(saveTimer)
  busy.value = true
  error.value = ''
  status.value = '保存中…'
  const version = editVersion
  try {
    const body = page.value.blocks === null
      ? { title: title.value, content: content.value, expected_revision: page.value.revision }
      : { title: title.value, blocks: JSON.parse(JSON.stringify(blocks.value)) as NoteBlock[], expected_revision: page.value.revision }
    const result = await api<NotePage>(`/api/documents/${encodeURIComponent(id.value)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    page.value = { ...page.value, ...result, title: title.value }
    dirty.value = editVersion !== version
    status.value = dirty.value ? '有未保存的更改' : '已保存'
    pages.value = pages.value.map(item => item.id === id.value ? { ...item, title: title.value, revision: result.revision } : item)
    if (dirty.value) persistDraft()
    else try { localStorage.removeItem(draftKey.value) } catch { /* Local storage can be unavailable. */ }
  } catch (cause) {
    conflict.value = cause instanceof ApiError && cause.status === 409
    error.value = cause instanceof Error ? cause.message : '保存失败'
    status.value = '保存失败'
  } finally {
    busy.value = false
    if (dirty.value && !conflict.value && status.value !== '保存失败') scheduleSave()
  }
}
async function flushBeforeLeave() {
  if (saveTimer) clearTimeout(saveTimer)
  while (busy.value) await new Promise(resolve => setTimeout(resolve, 50))
  if (dirty.value) await save()
  return !dirty.value
}
onBeforeRouteLeave(flushBeforeLeave)
onBeforeRouteUpdate(flushBeforeLeave)
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) { event.preventDefault(); event.returnValue = '' }
}
onMounted(() => {
  const ratio = Number.parseFloat(window.localStorage.getItem('deeptutor.co_writer.split_ratio.v2') || '')
  if (Number.isFinite(ratio)) editorRatio.value = Math.min(0.82, Math.max(0.18, ratio))
  syncScrollEnabled.value = window.localStorage.getItem('deeptutor.co_writer.sync_scroll.v2') !== '0'
  window.addEventListener('beforeunload', beforeUnload)
})
onUnmounted(() => {
  loadVersion++
  resizeObserver?.disconnect()
  stopResize?.()
  if (saveTimer) clearTimeout(saveTimer)
  window.removeEventListener('beforeunload', beforeUnload)
})

watch(editorRatio, value => window.localStorage.setItem('deeptutor.co_writer.split_ratio.v2', String(value)))
watch(syncScrollEnabled, value => window.localStorage.setItem('deeptutor.co_writer.sync_scroll.v2', value ? '1' : '0'))

async function openPage(targetId: string) {
  if (targetId === id.value) return
  if (await flushBeforeLeave()) await router.push(`/co-writer/${encodeURIComponent(targetId)}`)
}
async function createPage(parentId: string | null = null) {
  if (!(await flushBeforeLeave())) return
  mutating.value = true
  error.value = ''
  try {
    const saved = await api<NotePage>('/api/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', parent_id: parentId, content: '', blocks: [] }),
    })
    await loadPages()
    await router.push(`/co-writer/${encodeURIComponent(saved.id)}`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '新建页面失败' }
  finally { mutating.value = false }
}
async function metadata(patch: NoteMetadataPatch) {
  if (!page.value || !(await flushBeforeLeave())) return
  mutating.value = true
  error.value = ''
  try {
    const result = await api<NotePage>(`/api/documents/${encodeURIComponent(id.value)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, expected_revision: page.value.revision }),
    })
    page.value = result
    title.value = result.title
    content.value = result.content
    await loadPages()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '页面设置保存失败' }
  finally { mutating.value = false }
}
async function recoverCopy() {
  if (!recovery.value) return
  busy.value = true
  error.value = ''
  try {
    const saved = await api<NotePage>('/api/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${recovery.value.title}（恢复草稿）`, content: recovery.value.content, blocks: recovery.value.blocks }),
    })
    localStorage.removeItem(draftKey.value)
    recovery.value = null
    busy.value = false
    await router.push(`/co-writer/${saved.id}`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '恢复草稿失败' }
  finally { busy.value = false }
}
function discardRecovery() {
  try { localStorage.removeItem(draftKey.value) } catch { /* Local storage can be unavailable. */ }
  recovery.value = null
}
async function review(item: Suggestion, accept: boolean) {
  if (dirty.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await api(`/api/documents/${encodeURIComponent(id.value)}/suggestions/${encodeURIComponent(item.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept }),
    })
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '建议处理失败' }
  finally { busy.value = false }
}
async function exportDocument(format: 'md' | 'docx') {
  if (!page.value || !(await flushBeforeLeave())) return
  error.value = ''
  try {
    let blob: Blob
    if (format === 'docx') {
      const response = await fetch(scopedUrl('/api/documents/export/docx'), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.value, content: page.value.content }),
      })
      if (!response.ok) throw new Error(`导出失败：HTTP ${response.status}`)
      blob = await response.blob()
    } else blob = new Blob([page.value.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${title.value || '笔记'}.${format}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导出失败' }
}
function updateLearningBlock(updated: NoteBlock) {
  const index = blocks.value.findIndex(block => block.id === updated.id)
  if (index >= 0) blocks.value[index] = updated
  changed()
}
function inlineText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(raw => {
    if (typeof raw === 'string') return raw
    if (!raw || typeof raw !== 'object') return ''
    const item = raw as { text?: unknown; content?: unknown }
    return typeof item.text === 'string' ? item.text : inlineText(item.content)
  }).join('')
}
const activeAnchorText = computed(() => {
  const walk = (items: NoteBlock[]): NoteBlock | undefined => {
    for (const block of items) {
      if (block.id === activeBlockId.value) return block
      const nested = walk(block.children || [])
      if (nested) return nested
    }
    return undefined
  }
  const block = walk(blocks.value)
  if (!block) return '这一行已被删除'
  return inlineText(block.content).trim() || String(block.props.title || block.props.formula || '空白行')
})
const noteGeneration = computed(() => {
  if (!makeKind.value) return null
  const selected = makeKinds.find(item => item.kind === makeKind.value)
  return { block_id: generationBlockId.value, kind: makeKind.value, label: selected?.label || makeKind.value }
})
async function prepareChatSubmit() {
  if (makeKind.value && !generationBlockId.value) {
    const blockId = activeBlockId.value || blocks.value[0]?.id || ''
    if (!blockId) { error.value = '请先添加一个内容块。'; return false }
    const generated: NoteBlock = {
      id: crypto.randomUUID(), type: 'learning',
      props: { kind: makeKind.value, prompt: '', data: '{}' }, content: [], children: [],
    }
    if (richEditor.value) richEditor.value.insertBlock(generated)
    else blocks.value.push(generated)
    generationBlockId.value = generated.id
    await nextTick()
    if (pendingAnchor.value) pendingAnchor.value = { ...pendingAnchor.value, blockId: generated.id, origin: 'generate' }
    changed()
  }
  return flushBeforeLeave()
}
function sendStarter(prompt: string) { chatRef.value?.sendPrompt(prompt) }
function newThread() {
  const blockId = activeBlockId.value || blocks.value[0]?.id || ''
  if (!blockId) { error.value = '请先添加一个内容块。'; return }
  pendingAnchor.value = { blockId, quote: '', origin: 'ask' }
  makeKind.value = ''
  generationBlockId.value = ''
  threadListOpen.value = false
  assistantOpen.value = true
  if (route.query.chat) void router.replace({ path: route.path, query: {} })
}
function toggleCompanion() { if (assistantOpen.value) closeAssistant(); else newThread() }
function insertFavorites(items: FavoriteItem[]) {
  for (const item of items) {
    const block: NoteBlock = {
      id: crypto.randomUUID(), type: 'clip',
      props: {
        title: item.title, markdown: item.output || '',
        sourceUrl: `/notebooks/${encodeURIComponent(item.collection.id)}?record=${encodeURIComponent(item.id)}`,
        sourceId: item.id, favoriteType: item.type, summary: item.summary || '',
        metadata: JSON.stringify(item.metadata || {}), expanded: false,
      },
      content: [], children: [],
    }
    if (richEditor.value) richEditor.value.insertBlock(block)
    else blocks.value.push(block)
  }
  favoritesOpen.value = false
  changed()
}
function synthesizeFavorites(sources: string) {
  favoritesOpen.value = false
  companionPrompt.value = `将这些收藏整理成连贯的笔记，并为每一节注明来源。\n\n${sources}`
  newThread()
}
function closeAssistant() {
  assistantOpen.value = false
  threadListOpen.value = false
  makeKind.value = ''
  generationBlockId.value = ''
  pendingAnchor.value = null
  if (route.query.chat) void router.replace({ path: route.path, query: {} })
}
async function deleteThread(thread: Thread) {
  if (!confirm('删除这段伴读对话？')) return
  try {
    await api(`/api/documents/${encodeURIComponent(id.value)}/threads/${encodeURIComponent(thread.session_id)}`, { method: 'DELETE' })
    if (route.query.chat === thread.session_id) closeAssistant()
    await loadThreads()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除伴读对话失败' }
}
async function turnComplete() {
  makeKind.value = ''
  generationBlockId.value = ''
  await Promise.all([loadSuggestions(), loadThreads()])
}
watch(() => route.query.chat, async sessionId => {
  if (!sessionId) return
  assistantOpen.value = true
  if (!pendingAnchor.value) return
  try {
    await postThread(String(sessionId), pendingAnchor.value)
    pendingAnchor.value = null
    makeKind.value = ''
    generationBlockId.value = ''
    await loadThreads()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '伴读对话锚点保存失败' }
})
async function postThread(sessionId: string, anchor: { blockId: string; quote: string; origin: 'ask' | 'generate' }) {
  await api(`/api/documents/${encodeURIComponent(id.value)}/threads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, block_id: anchor.blockId, quote: anchor.quote, origin: anchor.origin }),
  })
}
async function scrollToBlock(blockId: string, flash = false) {
  await nextTick()
  const escaped = typeof CSS.escape === 'function' ? CSS.escape(blockId) : blockId
  const element = mainElement.value?.querySelector<HTMLElement>(`[data-block-id="${escaped}"], [data-note-opaque="${escaped}"]`)
  if (!element) return
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (flash) {
    element.classList.remove('is-anchor-flash')
    requestAnimationFrame(() => element.classList.add('is-anchor-flash'))
  }
}
function openThread(thread: Thread) {
  void router.replace({ path: route.path, query: { chat: thread.session_id } })
  void scrollToBlock(thread.block_id, true)
}
</script>

<template>
  <div class="dt-note-workspace co-writer-document">
    <NoteTopBar
      :page="page"
      :pages="pages"
      :invalid-parents="invalidParents"
      :status="status"
      :busy="mutating"
      :tree-open="treeOpen"
      :companion-open="assistantOpen"
      @toggle-tree="setTreeOpen(!treeOpen)"
      @toggle-companion="toggleCompanion"
      @open="openPage"
      @create="createPage()"
      @metadata="metadata"
      @favorite="favoritesOpen = true"
      @export="exportDocument"
    />
    <div v-if="error" role="alert" class="dt-note-banner is-error">
      <span class="flex-1">{{ error }}</span>
      <button v-if="dirty" class="dt-note-button" @click="save">重试</button>
      <button class="dt-note-button" @click="load">重新加载页面</button>
    </div>
    <div v-if="recovery" class="dt-note-banner co-writer-recovery" role="status">
      <span class="flex-1">本地草稿与当前页面版本不同。</span>
      <button class="dt-note-button" :disabled="busy" @click="recoverCopy">将草稿保存为新页面</button>
      <button class="dt-note-button" :disabled="busy" @click="discardRecovery">丢弃草稿</button>
    </div>
    <div class="dt-note-body">
      <NotePageTree v-if="treeOpen" :pages="pages" :current-id="id" :busy="mutating" @open="openPage" @create="createPage" />
      <main ref="mainElement" class="dt-note-main">
        <NoteOutline
          v-if="page && margin !== 'none' && !canEditContent"
          :blocks="blocks"
          :scroller="mainElement"
          :open="outlineOpen"
          :roomy="margin === 'wide'"
          @toggle="setOutlineOpen(!outlineOpen)"
          @jump="scrollToBlock($event)"
        />
        <div v-if="page" class="dt-note-document">
          <NotePageHead :page="page" :disabled="mutating" @title="updateTitle" @metadata="metadata" />
          <div ref="splitContainer" class="co-writer-editor-split">
            <section v-if="showEditor" ref="editorPane" class="co-writer-editor-pane" :style="{ width: showPreview ? `${editorRatio * 100}%` : '100%' }" @scroll.capture="synchronizePanes('editor', $event)">
              <header class="co-writer-pane-heading"><span>编辑</span><button type="button" aria-label="收起编辑" @click="showEditor = false">‹</button></header>
              <label v-if="canEditContent" class="co-writer-legacy">文档内容<textarea v-model="content" rows="22" @input="changed" /></label>
              <template v-else>
                <div class="note-asset-upload"><label>插入图片、音视频或 PDF<input type="file" aria-label="上传笔记附件" accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,video/mp4,application/pdf" :disabled="busy" @change="uploadAsset"></label></div>
                <RichNoteEditor ref="richEditor" v-model:blocks="blocks" :document-id="id" :epoch="editorEpoch" :show-preview="showPreview" :sync-scroll-enabled="syncScrollEnabled" @change="changed" @select="activeBlockId = $event" @toggle-sync="syncScrollEnabled = !syncScrollEnabled" />
              </template>
            </section>
            <div v-if="showEditor && showPreview" class="co-writer-splitter" role="separator" aria-orientation="vertical" aria-label="调整编辑和预览宽度" :aria-valuenow="Math.round(editorRatio * 100)" aria-valuemin="18" aria-valuemax="82" tabindex="0" @pointerdown="startResize" @dblclick="editorRatio = 0.5" @keydown="resizeWithKeyboard"><span /></div>
            <button v-if="!showEditor" type="button" class="co-writer-expand-pane" aria-label="展开编辑" @click="showEditor = true">›</button>
            <button v-if="!showPreview" type="button" class="co-writer-expand-pane" aria-label="展开预览" @click="showPreview = true">‹</button>
            <section v-if="showPreview" ref="previewPane" class="co-writer-preview-pane" :style="{ width: showEditor ? `${(1 - editorRatio) * 100}%` : '100%' }" @scroll="synchronizePanes('preview', $event)">
              <header class="co-writer-pane-heading"><span>预览</span><button type="button" aria-label="收起预览" @click="showPreview = false">›</button></header>
              <div class="co-writer-preview-content"><MarkdownView :content="previewContent" /></div>
            </section>
          </div>
          <LearningBlocks :blocks="blocks" :document-id="id" :document-title="title" @update-block="updateLearningBlock" @error="error = $event" />
          <NoteClipBlocks :blocks="blocks" />
          <section v-if="suggestions.length" class="co-writer-suggestions">
            <h2>写作建议</h2>
            <article v-for="item in suggestions" :key="item.id"><strong>{{ item.operation }}</strong><p>{{ item.markdown }}</p><p class="muted">{{ item.explanation }}</p><button :disabled="busy || dirty" @click="review(item, true)">接受</button><button :disabled="busy || dirty" @click="review(item, false)">忽略</button></article>
          </section>
          <section v-if="backlinks.length" class="dt-note-backlinks" aria-label="链接来源">
            <h2>链接来源</h2>
            <RouterLink v-for="item in backlinks" :key="item.id" :to="`/co-writer/${item.id}`" @click.prevent="openPage(item.id)"><span aria-hidden="true">{{ item.icon || '↗' }}</span>{{ item.title || '未命名页面' }}</RouterLink>
          </section>
        </div>
      </main>
      <div v-if="assistantOpen" class="dt-note-companion-slot">
        <aside class="dt-note-companion co-writer-assistant" :class="{ 'is-new': !route.query.chat }" aria-label="伴读助手">
          <header class="dt-note-companion-head">
            <div class="dt-note-companion-identity"><LegacyIcon name="sparkles" :size="16" /><div class="min-w-0"><h2>Dito</h2><p>{{ threads.find(item => item.session_id === route.query.chat)?.title || '新对话' }}</p></div></div>
            <div class="dt-note-companion-actions">
              <button class="dt-note-icon-button" aria-label="本页的对话" :aria-expanded="threadListOpen" @click="threadListOpen = !threadListOpen"><LegacyIcon name="journal" :size="15" /></button>
              <button class="dt-note-icon-button" aria-label="在这一行新开对话" @click="newThread"><LegacyIcon name="plus" :size="15" /></button>
              <button class="dt-note-icon-button" aria-label="收回到页面" @click="closeAssistant"><LegacyIcon name="close" :size="15" /></button>
            </div>
          </header>
          <div v-if="threadListOpen" class="dt-popover dt-note-thread-list">
            <div class="dt-menu-label">本页的对话</div>
            <button class="dt-menu-item" @click="newThread"><LegacyIcon name="plus" :size="13" />在这一行新开对话</button>
            <article v-for="thread in threads" :key="thread.session_id"><button class="dt-menu-item" @click="openThread(thread); threadListOpen = false">{{ thread.title || '未命名对话' }}</button><button class="dt-note-icon-button" :aria-label="`删除${thread.title || '对话'}`" @click="deleteThread(thread)"><LegacyIcon name="close" :size="12" /></button></article>
          </div>
          <button class="dt-note-anchor" @click="scrollToBlock(activeBlockId, true)"><LegacyIcon name="menu" :size="14" /><span>{{ activeAnchorText }}</span></button>
          <div v-if="!route.query.chat" class="dt-note-companion-thread">
            <div class="dt-note-companion-welcome">
              <div class="dt-note-starters"><button v-for="starter in quickStarters" :key="starter.label" @click="sendStarter(starter.prompt)"><LegacyIcon :name="starter.icon" :size="15" />{{ starter.label }}</button></div>
              <p class="dt-note-make-title">在这里生成</p>
              <div class="dt-note-make-chips"><button v-for="item in makeKinds" :key="item.kind" :aria-pressed="makeKind === item.kind" @click="makeKind = makeKind === item.kind ? '' : item.kind"><LegacyIcon :name="item.icon" :size="13" />{{ item.label }}</button></div>
            </div>
          </div>
          <ChatPage ref="chatRef" :note-document-id="id" :note-block-id="activeBlockId" :initial-prompt="companionPrompt" :note-generation="noteGeneration" :before-submit="prepareChatSubmit" @toggle-make="makeKind = makeKind ? '' : 'diagram'" @turn-complete="turnComplete" />
        </aside>
      </div>
    </div>
    <NoteFavoritesPicker v-if="favoritesOpen" @close="favoritesOpen = false" @insert="insertFavorites" @synthesize="synthesizeFavorites" />
  </div>
</template>
