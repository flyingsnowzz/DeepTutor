<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'
const ChatPage = defineAsyncComponent(() => import('./ChatPage.vue'))
import PdfReader from '../components/PdfReader.vue'
import EpubReader from '../components/EpubReader.vue'
import MediaReadingStage from '../components/MediaReadingStage.vue'
import AnnotationList from '../components/AnnotationList.vue'
import ReadingExtensions from '../components/ReadingExtensions.vue'
import ReadingNotebookDialog from '../components/ReadingNotebookDialog.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import { deleteAnnotation, listAnnotations, type AnnotationItem, type NormalisedRect } from '../readingAnnotations'
import ReaderDisplayControls from '../components/ReaderDisplayControls.vue'
import {
  loadReaderDisplayPreferences,
  saveReaderDisplayPreferences,
  type ReaderDisplayPreferences,
} from '../readingDisplay'

interface OutlineRow { locator: number; title: string; level?: number; synthesised?: boolean }
interface UnitReference { locator: number; source_href: string; title: string }
interface Material { material_id: string; title: string; filename: string; render_mode: string; status: string; unit_count?: number; revision?: number; outline?: OutlineRow[]; unit_refs?: UnitReference[] }
interface Workspace { workspace_id: string; title: string; active_material_id: string | null; tabs: { material: Material }[] }
interface ReadingConversation { workspace_id: string; session_id: string; title: string; active_material_id: string | null; linked_session_ids?: string[] }
interface OrganizedNotes { workspace_id: string; title: string; markdown: string; material_ids: string[]; annotation_count: number }

const route = useRoute(); const router = useRouter()
const workspaceId = computed(() => String(route.params.workspaceId || ''))
const workspace = ref<Workspace | null>(null); const activeId = ref(''); const detail = ref<Material | null>(null); const error = ref('')
const notice = ref('')
const conversations = ref<ReadingConversation[]>([])
const workspaceMenuOpen = ref(false)
const linkDialogOpen = ref(false)
const notebookDialogOpen = ref(false)
const selectedLinks = ref<string[]>([])
const linkBusy = ref(false)
const organizedNotes = ref<OrganizedNotes | null>(null)
const activeConversation = computed(() => conversations.value.find(item => item.session_id === String(route.params.sessionId || '')) || null)
const linkedSessionIds = computed(() => activeConversation.value?.linked_session_ids || [])
const linkCandidates = computed(() => conversations.value.filter(item => item.session_id !== activeConversation.value?.session_id))

const navigatorOpen = ref(false); const companionOpen = ref(true); const learningFocus = ref(false); const companionFocus = ref(false)
const annotations = ref<AnnotationItem[]>([])
const activeAnnotationId = ref<string | null>(null)
const contentFrame = ref<HTMLIFrameElement | null>(null)
const readerPreferences = ref<ReaderDisplayPreferences>(loadReaderDisplayPreferences())
const readerThemeClass = computed(() => `reader-theme-${readerPreferences.value.readerTheme}`)
const speaking = ref(false)
const readAloudBusy = ref(false)
let readAloudAudio: HTMLAudioElement | null = null
let readAloudUrl = ''
let readAloudGeneration = 0
const navTab = ref<'contents' | 'notes'>('contents'); const search = ref(''); const selection = ref<{ text: string; locator: number; rects?: NormalisedRect[] } | null>(null)
const selectionHistory = ref<Array<{ text: string; locator: number }>>([]); const targetLocator = ref(1); const chatPrompt = ref('')
const active = computed(() => workspace.value?.tabs.find(tab => tab.material.material_id === activeId.value)?.material || null)
const renderUrl = computed(() => active.value ? scopedUrl(`/api/reading/materials/${encodeURIComponent(active.value.material_id)}/${['pdf', 'epub'].includes(active.value.render_mode) ? 'raw' : 'render'}`) : '')
const targetHref = computed(() =>
  detail.value?.unit_refs?.find(reference => reference.locator === targetLocator.value)?.source_href || '',
)
const isTimedMedia = computed(() =>
  Boolean(active.value && ['video', 'audio'].includes(active.value.render_mode) && active.value.status === 'ready'),
)
const outlineRows = computed(() => { const rows = (detail.value?.outline || []).filter(row => !row.synthesised); if (rows.length) return rows; return Array.from({ length: detail.value?.unit_count || 0 }, (_, index) => ({ locator: index + 1, title: `第 ${index + 1} 页`, level: 1 })) })
const filteredOutline = computed(() => outlineRows.value.filter(row => row.title.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const filteredMaterials = computed(() => (workspace.value?.tabs || []).filter(tab => `${tab.material.title} ${tab.material.filename}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
async function load() {
  if (!workspaceId.value) return
  try {
    const result = await api<{ workspace: Workspace; sessions?: ReadingConversation[] }>(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}`)
    workspace.value = result.workspace
    conversations.value = result.sessions || []
    activeId.value = workspace.value.active_material_id || workspace.value.tabs[0]?.material.material_id || ''
    selection.value = null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '阅读集合加载失败' }
}
function openLinkDialog() { selectedLinks.value = [...linkedSessionIds.value]; linkDialogOpen.value = true; workspaceMenuOpen.value = false }
function toggleLink(id: string) { selectedLinks.value = selectedLinks.value.includes(id) ? selectedLinks.value.filter(item => item !== id) : [...selectedLinks.value, id] }
async function saveLinks() {
  const current = activeConversation.value
  if (!current || linkBusy.value) return
  linkBusy.value = true
  error.value = ''
  try {
    for (const id of selectedLinks.value.filter(id => !linkedSessionIds.value.includes(id))) await api(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}/sessions/${encodeURIComponent(current.session_id)}/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_session_id: id }) })
    for (const id of linkedSessionIds.value.filter(id => !selectedLinks.value.includes(id))) await api(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}/sessions/${encodeURIComponent(current.session_id)}/links/${encodeURIComponent(id)}`, { method: 'DELETE' })
    linkDialogOpen.value = false
    notice.value = '关联会话已保存'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存关联会话失败' }
  finally { linkBusy.value = false }
}
async function organizeNotes() {
  workspaceMenuOpen.value = false
  try { const result = await post<{ notes: OrganizedNotes }>(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}/notes/organize`, { material_ids: [] }); organizedNotes.value = result.notes; notice.value = '笔记已整理' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '整理笔记失败' }
}
async function copyOrganizedNotes() {
  if (!organizedNotes.value) return
  try { await navigator.clipboard.writeText(organizedNotes.value.markdown); notice.value = 'Markdown 已复制' }
  catch { error.value = '当前浏览器无法使用剪贴板' }
}

async function loadMaterial() { detail.value = null; targetLocator.value = 1; if (!activeId.value) return; try { const result = await api<Material | { material: Material }>(`/api/reading/materials/${encodeURIComponent(activeId.value)}`); detail.value = 'material' in result ? result.material : result } catch { detail.value = active.value } }
async function loadAnnotations() {
  if (!activeId.value) { annotations.value = []; return }
  try { annotations.value = await listAnnotations(activeId.value) }
  catch { annotations.value = [] }
}
function updateAnnotations(next: AnnotationItem[]) { annotations.value = next }
function openAnnotation(annotation: AnnotationItem) {
  activeAnnotationId.value = annotation.annotation_id
  jumpTo(annotation.locator)
  selection.value = { text: annotation.quote, locator: annotation.locator }
}
async function removeAnnotation(annotation: AnnotationItem) {
  if (!activeId.value) return
  try {
    await deleteAnnotation(activeId.value, annotation.annotation_id)
    annotations.value = annotations.value.filter(item => item.annotation_id !== annotation.annotation_id)
    if (activeAnnotationId.value === annotation.annotation_id) activeAnnotationId.value = null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除批注失败' }
}
watch(workspaceId, load, { immediate: true }); watch(activeId, loadMaterial)
watch(activeId, () => { activeAnnotationId.value = null; void loadAnnotations() }, { immediate: true })
watch(readerPreferences, value => { saveReaderDisplayPreferences(value); applyFrameDisplay() }, { deep: true })
watch(selection, value => { if (value && !selectionHistory.value.some(item => item.text === value.text && item.locator === value.locator)) selectionHistory.value.push(value) })
async function switchMaterial(id: string) { activeId.value = id; selection.value = null; try { await api(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}/materials/${encodeURIComponent(id)}/active`, { method: 'PUT' }) } catch (cause) { error.value = cause instanceof Error ? cause.message : '切换资料失败' } }
function applyFrameDisplay() {
  const document = contentFrame.value?.contentDocument
  if (!document) return
  const body = document.body
  if (!body) return
  const preferences = readerPreferences.value
  body.style.fontSize = `${preferences.fontSize}px`
  body.style.fontFamily = preferences.serif ? "ui-serif, Georgia, 'PingFang SC', serif" : "ui-sans-serif, system-ui, 'PingFang SC', sans-serif"
  body.style.maxWidth = `${preferences.lineWidth}ch`
  body.style.margin = '0 auto'
  body.style.padding = '24px'
  body.style.lineHeight = '1.75'
  const themes = {
    auto: { background: '', color: '' },
    sepia: { background: '#f4ecd8', color: '#473c2c' },
    night: { background: '#16181d', color: '#e8e5df' },
  }
  body.style.background = themes[preferences.readerTheme].background
  body.style.color = themes[preferences.readerTheme].color
}
function attachSelection(event: Event) {
  const frame = event.target as HTMLIFrameElement
  contentFrame.value = frame
  applyFrameDisplay()
  const document = frame.contentDocument
  if (!document) return
  document.addEventListener('mouseup', () => {
    const text = document.getSelection()?.toString().trim()
    if (text) selection.value = { text, locator: targetLocator.value }
  })
}
function updateReaderDisplay(value: Partial<ReaderDisplayPreferences>) {
  readerPreferences.value = { ...readerPreferences.value, ...value }
}
function jumpTo(locator: number) { targetLocator.value = locator; if (window.innerWidth < 1024) navigatorOpen.value = false }
async function onEpubLocation(locator: number, sourceAnchor: string, percentage: number) {
  targetLocator.value = locator
  if (!activeId.value) return
  await api(`/api/reading/materials/${encodeURIComponent(activeId.value)}/position`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locator, source_anchor: sourceAnchor, percentage }),
  }).catch(() => null)
}
function onMediaLocator(locator: number) {
  targetLocator.value = locator
}
function stopReadAloud() {
  readAloudGeneration += 1
  readAloudAudio?.pause()
  readAloudAudio = null
  if (readAloudUrl) URL.revokeObjectURL(readAloudUrl)
  readAloudUrl = ''
  window.speechSynthesis?.cancel()
  speaking.value = false
  readAloudBusy.value = false
}
async function readAloud() {
  if (speaking.value || readAloudBusy.value) { stopReadAloud(); return }
  if (!activeId.value) return
  const generation = ++readAloudGeneration
  readAloudBusy.value = true
  try {
    const response = await fetch(scopedUrl(`/api/reading/materials/${encodeURIComponent(activeId.value)}/read-aloud`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locator: targetLocator.value }),
    })
    if (!response.ok) throw new Error(`朗读服务不可用 (${response.status})`)
    const blob = await response.blob()
    if (!blob.size || generation !== readAloudGeneration) return
    readAloudUrl = URL.createObjectURL(blob)
    const audio = new Audio(readAloudUrl)
    readAloudAudio = audio
    audio.onended = stopReadAloud
    audio.onerror = () => fallbackReadAloud(generation)
    await audio.play()
    if (generation === readAloudGeneration) speaking.value = true
  } catch {
    fallbackReadAloud(generation)
  } finally {
    if (generation === readAloudGeneration) readAloudBusy.value = false
  }
}
function fallbackReadAloud(generation: number) {
  if (generation !== readAloudGeneration || !('speechSynthesis' in window)) return
  const text = selection.value?.text || active.value?.title || ''
  if (!text) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'
  utterance.onend = () => { if (generation === readAloudGeneration) speaking.value = false }
  utterance.onerror = utterance.onend
  window.speechSynthesis.speak(utterance)
  speaking.value = true
}
function quizPage() { chatPrompt.value = `请围绕当前资料第 ${targetLocator.value} 页设计一组由浅入深的测验，先只给题目，不要直接给答案。`; companionOpen.value = true }
async function removeCurrentMaterial(id: string) { if (!confirm('从资料组移除这份资料？')) return; await api(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}/materials/${encodeURIComponent(id)}`, { method: 'DELETE' }); await load() }
function newConversation() { router.push(`/learning/reading/${encodeURIComponent(workspaceId.value)}/sessions`) }
onBeforeUnmount(stopReadAloud)
</script>

<template>
  <div class="reading-study" :class="[{ 'learning-focus': learningFocus, 'companion-focus': companionFocus, 'navigator-closed': !navigatorOpen, 'companion-closed': !companionOpen }, readerThemeClass]">
    <div class="reading-workspace-main">
      <aside v-if="navigatorOpen" class="reading-navigator"><header><div role="tablist"><button :aria-selected="navTab === 'contents'" @click="navTab = 'contents'">目录</button><button :aria-selected="navTab === 'notes'" @click="navTab = 'notes'">批注 <small>{{ annotations.length }}</small></button></div><button aria-label="收起目录" @click="navigatorOpen = false"><LegacyIcon name="collapse" :size="14" /></button></header><label class="reading-nav-search"><LegacyIcon name="search" :size="12" /><input v-model="search" placeholder="搜索目录与资料"></label><div v-if="navTab === 'contents'" class="reading-nav-body"><section class="reading-nav-materials"><h2>资料 <small>{{ workspace?.tabs.length || 0 }}</small></h2><div v-for="tab in filteredMaterials" :key="tab.material.material_id" class="reading-nav-material" :class="{ active: activeId === tab.material.material_id }"><button @click="switchMaterial(tab.material.material_id)"><LegacyIcon :name="tab.material.render_mode === 'pdf' ? 'journal' : tab.material.render_mode === 'video' ? 'terminal' : 'resources'" :size="13" /><span>{{ tab.material.title || tab.material.filename }}</span></button><button title="移除资料" @click="removeCurrentMaterial(tab.material.material_id)">×</button></div></section><section class="reading-outline"><h2>本页目录</h2><button v-for="row in filteredOutline" :key="row.locator" :class="{ active: targetLocator === row.locator }" :style="{ paddingLeft: `${10 + (row.level || 1) * 8}px` }" @click="jumpTo(row.locator)">{{ row.title }}</button><p v-if="!filteredOutline.length" class="muted">没有可显示的目录。</p></section></div><div v-else class="reading-nav-body"><AnnotationList :annotations="annotations" :active-id="activeAnnotationId" @select="openAnnotation" @delete="removeAnnotation" /><details v-if="selectionHistory.length" class="reading-selection-history"><summary>本次阅读的选区</summary><button v-for="(item, index) in selectionHistory" :key="index" class="reading-note-row" @click="jumpTo(item.locator); selection = item"><span>“{{ item.text }}”</span><small>第 {{ item.locator }} 页</small></button></details><p v-if="!annotations.length && !selectionHistory.length" class="reading-notes-empty">选中的文字和批注会显示在这里。</p></div></aside>
      <section class="reading-document"><header class="reading-workspace-bar"><button class="reading-bar-button" :title="navigatorOpen ? '收起目录' : '展开目录'" @click="navigatorOpen = !navigatorOpen"><LegacyIcon :name="navigatorOpen ? 'collapse' : 'expand'" :size="14" /></button><span class="dt-reading-feature">沉浸式阅读</span><span class="dt-crumb-sep">/</span><RouterLink class="reading-collection-crumb" :to="`/learning/reading/folders/${encodeURIComponent(workspaceId)}`"><LegacyIcon name="journal" :size="14" /><span>{{ workspace?.title || '阅读集合' }}</span></RouterLink><select class="reading-material-select" :value="activeId" aria-label="当前资料" @change="switchMaterial(($event.target as HTMLSelectElement).value)"><option v-for="tab in workspace?.tabs || []" :key="tab.material.material_id" :value="tab.material.material_id">{{ tab.material.title || tab.material.filename }}</option></select><div class="reading-bar-actions"><ReaderDisplayControls :preferences="readerPreferences" :show-spread="active?.render_mode === 'epub'" @change="updateReaderDisplay" /><button :title="speaking ? '停止朗读' : readAloudBusy ? '正在准备朗读…' : '朗读'" :disabled="!active || active.status !== 'ready'" :aria-pressed="speaking" :class="{ speaking, loading: readAloudBusy }" @click="readAloud"><LegacyIcon :name="speaking ? 'stop' : 'voice'" :size="13" :class="{ 'is-spinning': readAloudBusy }" /></button><button title="本页测验" :disabled="!active || active.status !== 'ready'" @click="quizPage">▣</button><button :class="{ active: learningFocus }" :title="learningFocus ? '退出全屏学习' : '全屏学习'" @click="learningFocus = !learningFocus"><LegacyIcon :name="learningFocus ? 'collapse' : 'expand'" :size="14" /></button><button v-if="!companionOpen" title="打开 Companion" @click="companionOpen = true"><LegacyIcon name="chat" :size="14" /></button><span class="reading-menu-anchor"><button title="更多操作" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="workspaceMenuOpen" @click="workspaceMenuOpen = !workspaceMenuOpen">•••</button><div v-if="workspaceMenuOpen" class="reading-workspace-menu" role="menu" aria-label="更多操作"><p>集合</p><button role="menuitem" @click="organizeNotes">▤ 整理笔记</button><button role="menuitem" @click="notebookDialogOpen = true; workspaceMenuOpen = false">▱ 发送到收藏夹</button><RouterLink role="menuitem" :to="`/learning/reading/folders/${encodeURIComponent(workspaceId)}`">••• 资料组设置</RouterLink><template v-if="activeConversation"><div class="reading-workspace-menu-divider" /><p>对话</p><button role="menuitem" @click="openLinkDialog">↗ 关联阅读对话</button></template></div></span></div></header><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="error" class="error" role="alert">{{ error }}</p><EpubReader v-if="active?.render_mode === 'epub' && active.status === 'ready' && renderUrl" :url="renderUrl" :target-locator="targetLocator" :target-href="targetHref" :material-id="activeId" :annotations="annotations" :active-annotation-id="activeAnnotationId" :preferences="readerPreferences" @annotations-change="updateAnnotations" @annotation-select="openAnnotation" @location-change="onEpubLocation" /><PdfReader v-else-if="active?.render_mode === 'pdf' && active.status === 'ready' && renderUrl" :url="renderUrl" :target-locator="targetLocator" :material-id="activeId" :annotations="annotations" :active-annotation-id="activeAnnotationId" @select="selection = $event" @annotations-change="updateAnnotations" @annotation-select="openAnnotation" /><MediaReadingStage v-else-if="isTimedMedia" :material-id="activeId" :initial-locator="targetLocator" @locator-change="onMediaLocator" @select="selection = $event" /><iframe v-else-if="active?.status === 'ready' && renderUrl" ref="contentFrame" :key="renderUrl" :src="renderUrl" :title="active.title || active.filename" @load="attachSelection" /><div v-else class="reading-document-empty"><LegacyIcon name="journal" :size="30" /><p>{{ active ? `资料状态：${active.status}` : '集合中暂无资料。' }}</p><RouterLink v-if="!active" :to="`/learning/reading/folders/${encodeURIComponent(workspaceId)}`">添加资料</RouterLink></div></section>
      <aside v-if="companionOpen" class="reading-chat"><header class="reading-companion-head"><span>伴读</span><button title="新对话" @click="newConversation"><LegacyIcon name="edit" :size="14" /></button><button :title="companionFocus ? '退出 Companion 专注' : 'Companion 专注'" @click="companionFocus = !companionFocus"><LegacyIcon :name="companionFocus ? 'collapse' : 'expand'" :size="14" /></button><button title="收起 Companion" @click="companionOpen = false"><LegacyIcon name="close" :size="14" /></button></header><div v-if="selection" class="reading-selection"><div><span>“{{ selection.text }}”</span><button @click="selection = null">清除引用</button></div><ReadingExtensions :material-id="activeId" :selection="selection.text" :locator="selection.locator" :session-id="String(route.params.sessionId || '')" /></div><div v-if="!route.params.sessionId && !selection" class="reading-companion-welcome"><LegacyIcon name="journal" :size="42" /><h2>边读边问</h2><p>在文档里选中任意一段，就地提问、解释或翻译；也可以直接在下面问。回答会标出出处页码。</p></div><ChatPage reading :linked-session-ids="linkedSessionIds" :material-id="activeId" :reading-selection="selection?.text" :reading-locator="selection?.locator" :reading-revision="active?.revision" :initial-prompt="chatPrompt" /></aside>
    </div>
    <ReadingNotebookDialog v-if="notebookDialogOpen" :workspace-id="workspaceId" @close="notebookDialogOpen = false" @saved="notebookDialogOpen = false; notice = '阅读笔记已发送到收藏夹'" />
    <div v-if="linkDialogOpen" class="reading-dialog-overlay" @mousedown.self="!linkBusy && (linkDialogOpen = false)"><section class="reading-link-dialog" role="dialog" aria-modal="true" aria-label="关联阅读对话"><header><h2>关联阅读对话</h2></header><p class="muted">关联的对话会作为历史上下文显式传入，但仍保持独立，不会出现在普通聊天历史中。</p><div class="reading-link-list"><button v-for="conversation in linkCandidates" :key="conversation.session_id" type="button" :aria-pressed="selectedLinks.includes(conversation.session_id)" @click="toggleLink(conversation.session_id)"><span>{{ selectedLinks.includes(conversation.session_id) ? '✓' : '' }}</span><strong>{{ conversation.title }}</strong></button><p v-if="!linkCandidates.length" class="muted">请先创建另一段阅读对话。</p></div><p v-if="error" class="error" role="alert">{{ error }}</p><footer><button :disabled="linkBusy" @click="linkDialogOpen = false">取消</button><button class="primary" :disabled="linkBusy" @click="saveLinks">{{ linkBusy ? '保存中…' : '保存关联' }}</button></footer></section></div>
    <div v-if="organizedNotes" class="reading-dialog-overlay" @mousedown.self="organizedNotes = null"><section class="reading-link-dialog" role="dialog" aria-modal="true" aria-label="整理后的阅读笔记"><header><h2>整理后的阅读笔记</h2><button aria-label="关闭" @click="organizedNotes = null">×</button></header><p class="muted">{{ organizedNotes.annotation_count }} 条批注 <button @click="copyOrganizedNotes">复制 Markdown</button></p><pre class="reading-organized-markdown">{{ organizedNotes.markdown }}</pre></section></div>
  </div>
</template>
