<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, post } from '../api'
import MarkdownView from '../components/MarkdownView.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import { scopedUrl } from '../workspaceScope'

interface Book { id: string; title: string; description: string; status: string; revision: number; updated_at?: number; page_count: number; chapter_count: number; can_edit?: boolean; can_delete?: boolean; proposal?: Proposal | null; reading?: { percent: number; current_page_id: string; visited_pages?: number; total_pages?: number } }
interface Proposal { title: string; description: string; scope: string; target_level: string; estimated_chapters: number; rationale: string }
interface Chapter { id: string; title: string; summary?: string; page_ids: string[]; order: number }
interface Spine { chapters: Chapter[] }
interface Block { id: string; type: string; title?: string; status: string; payload: Record<string, unknown>; error?: string }
interface Page { id: string; title: string; status: string; order: number; blocks: Block[]; block_count?: number; learning_objectives?: string[] }
interface Detail { book: Book; spine: Spine | null; pages: Page[]; progress: { current_page_id: string; visited_page_ids: string[]; bookmarked_page_ids: string[] } }
interface Capture { id: string; status: string; source_text: string; chapter_title?: string; user_note?: string; updated_at: number }
const REVIEWABLE_STATUSES = new Set(['captured', 'drafted', 'pending_confirmation'])

const route = useRoute()
const router = useRouter()
const list = ref<Book[]>([])
const canCreate = ref(false)
const detail = ref<Detail | null>(null)
const page = ref<Page | null>(null)
const intent = ref('')
const createOpen = ref(false)
const pendingDeleteId = ref('')
const search = ref('')
const sidebarCollapsed = ref(false)
const depth = ref('standard')
const proposal = ref<Proposal | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const editingBlock = ref('')
const blockTitle = ref('')
const blockBody = ref('')
const newBlockType = ref('paragraph')
const answers = ref<Record<string, string>>({})
const quizResults = ref<Record<string, boolean | null>>({})
const deepTopic = ref('')
const supplementTopic = ref('')
const captures = ref<Capture[]>([])
const capturesLoading = ref(false)
const capturesOpen = ref(true)
const showAllCaptures = ref(false)
const outlineCollapsed = ref(true)
const activeOutlineBlock = ref('')
const reviewableCaptures = computed(() => captures.value.filter(item => REVIEWABLE_STATUSES.has(item.status)))
const visibleCaptures = computed(() => showAllCaptures.value ? captures.value : reviewableCaptures.value)
let refreshTimer: ReturnType<typeof setInterval> | undefined
const bookId = computed(() => String(route.params.bookId || ''))
const pageId = computed(() => String(route.params.pageId || ''))
const chapters = computed(() => detail.value?.spine?.chapters || [])
const filteredBooks = computed(() => list.value.filter(book => `${book.title} ${book.description}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const readyCount = computed(() => list.value.filter(book => book.status === 'ready').length)
const compilingCount = computed(() => list.value.filter(book => ['compiling','paused','draft','spine_ready'].includes(book.status)).length)
const chapterTotal = computed(() => list.value.reduce((sum, book) => sum + (book.chapter_count || 0), 0))
const pages = computed(() => detail.value?.pages || [])
const orderedPages = computed(() => [...pages.value].sort((a, b) => a.order - b.order))
const pageIndex = computed(() => orderedPages.value.findIndex(item => item.id === pageId.value))
const previousPage = computed(() => pageIndex.value > 0 ? orderedPages.value[pageIndex.value - 1] : null)
const nextPage = computed(() => pageIndex.value >= 0 && pageIndex.value < orderedPages.value.length - 1 ? orderedPages.value[pageIndex.value + 1] : null)
function body(block: Block) { return String(block.payload.body ?? block.payload.content ?? block.payload.text ?? '') }
function blockImage(block: Block) { const value = block.payload.image_url ?? block.payload.url; return typeof value === 'string' && /^(\/|https?:\/\/)/.test(value) ? scopedUrl(value) : '' }
function blockOptions(block: Block) { return Object.entries((block.payload.options || {}) as Record<string, string>) }

async function loadCaptures() {
  if (!bookId.value) { captures.value = []; return }
  capturesLoading.value = true
  try {
    const result = await api<{ captures: Capture[] }>(`/api/books/${encodeURIComponent(bookId.value)}/learning-captures`)
    captures.value = [...(result.captures || [])].sort((a, b) => b.updated_at - a.updated_at)
  } catch { captures.value = [] }
  finally { capturesLoading.value = false }
}
function normalizeCaptureText(value: string) { return value.replace(/\s+/g, ' ').trim() }
async function captureSelection() {
  if (!page.value) return
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) { error.value = '请先选择要保存的文本。'; return }
  const sourceText = normalizeCaptureText(selection.toString())
  if (!sourceText) { error.value = '选中的文本为空。'; return }
  const anchor = selection.anchorNode
  const anchorElement = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as HTMLElement | null
  const blockElement = anchorElement?.closest('[data-book-block-id]') as HTMLElement | null
  const blockId = blockElement?.getAttribute('data-book-block-id') || ''
  const context = normalizeCaptureText(blockElement?.textContent || selection.toString())
  const start = context.indexOf(sourceText)
  const end = start >= 0 ? start + sourceText.length : -1
  const before = start >= 0 ? context.slice(Math.max(0, start - 120), start) : ''
  const after = end >= 0 ? context.slice(end, Math.min(context.length, end + 120)) : ''
  busy.value = true
  error.value = ''
  try {
    const result = await post<{ capture: Capture }>(`/api/books/${encodeURIComponent(bookId.value)}/learning-captures`, {
      page_id: pageId.value, block_id: blockId, source_text: sourceText,
      context_before: before, context_after: after,
      source_locator: `/books/${bookId.value}/pages/${pageId.value}${blockId ? `/blocks/${blockId}` : ''}`,
      book_title: detail.value?.book.title || '', chapter_title: page.value.title || '',
    })
    captures.value = [result.capture, ...captures.value.filter(item => item.id !== result.capture.id)]
    capturesOpen.value = true
    notice.value = '已保存选中文本'
    selection.removeAllRanges()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存选中文本失败' }
  finally { busy.value = false }
}
async function updateCapture(capture: Capture, status: 'approved' | 'rejected') {
  busy.value = true
  try {
    const result = await api<{ capture: Capture }>(`/api/books/${encodeURIComponent(bookId.value)}/learning-captures/${encodeURIComponent(capture.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    captures.value = captures.value.map(item => item.id === capture.id ? result.capture : item).sort((a, b) => b.updated_at - a.updated_at)
    notice.value = status === 'approved' ? '高亮已确认' : '高亮已忽略'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新高亮失败' }
  finally { busy.value = false }
}
function jumpToBlock(blockId: string) {
  activeOutlineBlock.value = blockId
  document.querySelector(`[data-book-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
function navigatePage(target: Page | null) {
  if (target) void router.push(`/learning/books/${encodeURIComponent(bookId.value)}/pages/${encodeURIComponent(target.id)}`)
}
function onReaderKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
  if (event.key === 'ArrowLeft') { event.preventDefault(); navigatePage(previousPage.value) }
  else if (event.key === 'ArrowRight') { event.preventDefault(); navigatePage(nextPage.value) }
}

async function load() {
  error.value = ''
  try {
    const result = await api<{ books: Book[]; can_create: boolean }>('/api/books')
    list.value = result.books; canCreate.value = result.can_create
    if (bookId.value) {
      detail.value = await api<Detail>(`/api/books/${encodeURIComponent(bookId.value)}?include_blocks=false`)
      void loadCaptures()
      proposal.value = detail.value.book.proposal ? { ...detail.value.book.proposal } : null
      page.value = pageId.value ? (await api<{ page: Page }>(`/api/books/${encodeURIComponent(bookId.value)}/pages/${encodeURIComponent(pageId.value)}`)).page : null
      if (page.value) await post('/api/books/progress/visit', { book_id: bookId.value, page_id: pageId.value }).catch(() => null)
    } else { detail.value = null; page.value = null; proposal.value = null }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '书籍加载失败' }
}
onMounted(() => window.addEventListener('keydown', onReaderKeydown))
onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer); window.removeEventListener('keydown', onReaderKeydown) })
watch(() => detail.value?.book.status, status => { if (refreshTimer) clearInterval(refreshTimer); if (status === 'compiling') refreshTimer = setInterval(load, 4000) })
watch(() => route.fullPath, load, { immediate: true })
async function create() {
  if (!intent.value.trim()) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const result = await post<{ book: Book }>('/api/books', { user_intent: intent.value.trim(), language: 'zh', fallback_language: 'zh', depth: depth.value })
    createOpen.value = false
    await router.push(`/learning/books/${encodeURIComponent(result.book.id)}`)
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败' }
  finally { busy.value = false }
}
async function confirmProposal() {
  if (!detail.value || !proposal.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await post('/api/books/confirm-proposal', { book_id: bookId.value, proposal: proposal.value, expected_revision: detail.value.book.revision }); await load(); notice.value = '目录草案已生成' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '确认提案失败' }
  finally { busy.value = false }
}
async function confirmSpine() {
  if (!detail.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await post('/api/books/confirm-spine', { book_id: bookId.value, spine: detail.value.spine, expected_revision: detail.value.book.revision, auto_compile: true }); await load(); notice.value = '已开始生成章节' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '确认目录失败' }
  finally { busy.value = false }
}
async function action(kind: 'pause' | 'resume') {
  if (!detail.value) return
  busy.value = true; error.value = ''
  try { await post(`/api/books/${kind}`, { book_id: bookId.value, expected_revision: detail.value.book.revision }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { busy.value = false }
}
async function bookmark() {
  if (!page.value) return
  try { const result = await post<{ progress: Detail['progress'] }>('/api/books/progress/bookmark', { book_id: bookId.value, page_id: pageId.value }); if (detail.value) detail.value.progress = result.progress }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '书签保存失败' }
}
async function compilePage() {
  if (!page.value || !detail.value) return
  busy.value = true; error.value = ''
  try { await post('/api/books/compile-page', { book_id: bookId.value, page_id: pageId.value, expected_revision: detail.value.book.revision }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '章节生成失败' }
  finally { busy.value = false }
}
function editBlock(block: Block) { editingBlock.value = block.id; blockTitle.value = block.title || ''; blockBody.value = body(block) }
async function updateBlock(block: Block) {
  if (!detail.value) return
  busy.value = true
  try { await post('/api/books/update-block', { book_id: bookId.value, page_id: pageId.value, block_id: block.id, title: blockTitle.value, body: blockBody.value, expected_revision: detail.value.book.revision }); editingBlock.value = ''; await load(); notice.value = '内容块已保存' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存内容块失败' }
  finally { busy.value = false }
}
async function insertBlock() {
  if (!detail.value) return
  busy.value = true
  try { await post('/api/books/insert-block', { book_id: bookId.value, page_id: pageId.value, block_type: newBlockType.value, params: { title: blockTitle.value, body: blockBody.value }, compile_now: true, expected_revision: detail.value.book.revision }); blockTitle.value = ''; blockBody.value = ''; await load(); notice.value = '内容块已插入' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '插入内容块失败' }
  finally { busy.value = false }
}
async function deleteBlock(block: Block) {
  if (!detail.value || !confirm('删除此内容块？')) return
  busy.value = true
  try { await post('/api/books/delete-block', { book_id: bookId.value, page_id: pageId.value, block_id: block.id, expected_revision: detail.value.book.revision }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除内容块失败' }
  finally { busy.value = false }
}
async function moveBlock(block: Block, delta: number) {
  if (!page.value || !detail.value) return
  const index = page.value.blocks.findIndex(item => item.id === block.id)
  const position = index + delta
  if (index < 0 || position < 0 || position >= page.value.blocks.length) return
  busy.value = true
  try { await post('/api/books/move-block', { book_id: bookId.value, page_id: pageId.value, block_id: block.id, new_position: position, expected_revision: detail.value.book.revision }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '移动内容块失败' }
  finally { busy.value = false }
}
async function regenerateBlock(block: Block) {
  if (!detail.value) return
  busy.value = true
  try { await bookOperation({ type: 'regenerate_block', book_id: bookId.value, page_id: pageId.value, block_id: block.id, expected_revision: detail.value.book.revision }, 'regenerate_block_result'); await load(); notice.value = '内容块已重新生成' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '重新生成失败' }
  finally { busy.value = false }
}
function bookOperation(message: Record<string, unknown>, resultType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${location.host}${scopedUrl('/ws/books')}`)
    socket.onopen = () => socket.send(JSON.stringify(message))
    socket.onmessage = event => {
      try {
        const value = JSON.parse(event.data)
        if (value.type === resultType) { socket.close(); resolve() }
        else if (value.type === 'error') { socket.close(); reject(new Error(value.message || value.detail || '书籍操作失败')) }
      } catch { /* Ignore non-JSON progress events. */ }
    }
    socket.onerror = () => { socket.close(); reject(new Error('书籍服务连接失败')) }
  })
}
async function answerQuiz(block: Block) {
  const answer = answers.value[block.id]
  if (!answer) return
  const correct = String(block.payload.correct_answer ?? '') === answer
  quizResults.value[block.id] = correct
  try { await post('/api/books/quiz-attempt', { book_id: bookId.value, page_id: pageId.value, block_id: block.id, question_id: block.payload.question_id, user_answer: answer, is_correct: correct, submission_id: crypto.randomUUID() }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '提交测验失败' }
}
async function supplement(deep = false) {
  const topic = deep ? deepTopic.value.trim() : supplementTopic.value.trim()
  if (!topic || !detail.value) return
  busy.value = true
  try {
    if (deep) { const result = await post<{ page: Page }>('/api/books/deep-dive', { book_id: bookId.value, parent_page_id: pageId.value, topic, content_type: 'concept', expected_revision: detail.value.book.revision }); await router.push(`/learning/books/${encodeURIComponent(bookId.value)}/pages/${encodeURIComponent(result.page.id)}`) }
    else await post('/api/books/supplement', { book_id: bookId.value, page_id: pageId.value, topic, expected_revision: detail.value.book.revision })
    deepTopic.value = ''; supplementTopic.value = ''; await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '生成补充内容失败' }
  finally { busy.value = false }
}
async function deleteLibraryBook(id: string) {
  if (pendingDeleteId.value !== id) { pendingDeleteId.value = id; return }
  try { await api(`/api/books/${encodeURIComponent(id)}`, { method: 'DELETE' }); pendingDeleteId.value = ''; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除书籍失败' }
}
async function remove() {
  if (!detail.value || !confirm(`删除书籍“${detail.value.book.title}”？`)) return
  try { await api(`/api/books/${encodeURIComponent(bookId.value)}`, { method: 'DELETE' }); await router.push('/learning/books') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
}
</script>

<template>
  <main class="feature-page books-page">
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <template v-if="!bookId"><div class="books-library"><header class="books-library-bar"><div><h1><LegacyIcon name="bookOpen" :size="15" :stroke-width="1.6" />书籍</h1><p>生成、浏览并学习你的 AI 编写书籍。</p></div><button class="primary" @click="createOpen = true"><span>＋</span> 新建书籍</button></header><div class="books-search"><span>⌕</span><input v-model="search" type="search" placeholder="搜索书籍"></div><section class="books-stats"><article><span>▱</span><div><small>书籍总数</small><strong>{{ list.length }}</strong></div></article><article><span>✧</span><div><small>就绪</small><strong>{{ readyCount }}</strong></div></article><article><span>◷</span><div><small>进行中</small><strong>{{ compilingCount }}</strong></div></article><article><span>▤</span><div><small>章节</small><strong>{{ chapterTotal }}</strong></div></article></section><div class="books-library-title"><h2>我的书库</h2><span>共 {{ list.length }} 本，显示 {{ filteredBooks.length }} 本</span></div><section v-if="!filteredBooks.length" class="books-empty"><span>▱</span><h2>{{ search ? '没有匹配的书籍' : '暂无书籍' }}</h2><p>{{ search ? '尝试其他关键词。' : '从知识库、聊天片段，或一个主题开始创建你的第一本 AI 书籍。' }}</p><button v-if="!search" class="primary" @click="createOpen = true"><span>＋</span> 新建书籍</button></section><div v-else class="books-grid"><RouterLink v-for="book in filteredBooks" :key="book.id" :to="`/learning/books/${encodeURIComponent(book.id)}`" class="book-card"><div v-if="book.reading?.percent" class="book-card-progress-line"><span :style="{ width: `${book.reading.percent}%` }" /></div><div class="book-card-body"><h3>{{ book.title }}</h3><p>{{ book.description || '打开书籍查看章节大纲。' }}</p><div class="book-card-facts"><span v-if="book.status !== 'ready'" class="book-card-status">{{ book.status }}</span><span>{{ book.chapter_count }} 章</span><span>{{ book.page_count }} 页</span><span v-if="book.reading?.percent">已读 {{ Math.round(book.reading.percent) }}%</span></div><div class="book-card-footer"><small v-if="book.updated_at">{{ new Date(book.updated_at * 1000).toLocaleDateString('zh-CN') }}</small><button @click.prevent.stop>开始阅读 →</button></div></div><button v-if="book.can_delete !== false" class="book-card-delete" :aria-label="pendingDeleteId === book.id ? '再次点击确认删除' : '删除书籍'" @click.prevent.stop="deleteLibraryBook(book.id)">{{ pendingDeleteId === book.id ? '确认' : '×' }}</button></RouterLink></div></div><Teleport to="body"><div v-if="createOpen" class="books-create-overlay" @click.self="createOpen = false"><form class="books-create-dialog" role="dialog" aria-modal="true" aria-label="新建书籍" @submit.prevent="create"><header><div><h2>新建书籍</h2><p>说出一个主题，DeepTutor 会先构思提案，再与你确认章节。</p></div><button type="button" aria-label="关闭" @click="createOpen = false">×</button></header><label>你想学习什么？<textarea v-model="intent" rows="5" required placeholder="描述学习主题和目标" autofocus /></label><label>内容深度<select v-model="depth"><option value="brief">简要</option><option value="standard">标准</option><option value="deep">深入</option></select></label><footer><button type="button" @click="createOpen = false">取消</button><button class="primary" :disabled="busy || !intent.trim()">{{ busy ? '构思中…' : '开始创建' }}</button></footer></form></div></Teleport></template>
    <template v-else-if="detail"><div class="book-reader-shell"><aside v-if="!sidebarCollapsed" class="book-sidebar"><div class="book-sidebar-top"><RouterLink to="/learning/books">← 全部书籍</RouterLink><button title="收起章节" @click="sidebarCollapsed = true">‹</button></div><div class="book-sidebar-title"><strong>{{ detail.book.title }}</strong><small>{{ detail.book.status }} · {{ detail.book.chapter_count }} 章</small></div><a :href="scopedUrl(`/api/books/${encodeURIComponent(bookId)}/export`)" download>⇩ 导出 Markdown</a><div class="book-sidebar-actions"><button v-if="detail.book.can_edit && detail.book.status === 'compiling'" @click="action('pause')">暂停编写</button><button v-if="detail.book.can_edit && detail.book.status === 'paused'" @click="action('resume')">继续编写</button><button v-if="detail.book.can_delete" class="legacy-danger" @click="remove">删除书籍</button></div><nav><h3>章节</h3><RouterLink v-for="item in orderedPages" :key="item.id" :to="`/learning/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(item.id)}`" :class="{ active: item.id === pageId }"><span>{{ detail.progress.visited_page_ids.includes(item.id) ? '✓' : '○' }}</span><div>{{ item.title }}<small>{{ item.status }}<template v-if="detail.progress.bookmarked_page_ids.includes(item.id)"> · 书签</template></small></div></RouterLink></nav></aside><button v-else class="book-sidebar-collapsed" title="展开章节" @click="sidebarCollapsed = false">›</button><div class="book-reader-main">      <div class="book-layout"><section class="book-reader"><template v-if="page"><div class="feature-heading book-page-heading"><div><h2>{{ page.title }}</h2><p>{{ page.learning_objectives?.join(' · ') }}</p></div><div class="partner-actions"><RouterLink v-if="previousPage" :to="`/learning/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(previousPage.id)}`">上一章</RouterLink><RouterLink v-if="nextPage" :to="`/learning/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(nextPage.id)}`">下一章</RouterLink><a :href="scopedUrl(`/api/books/${encodeURIComponent(bookId)}/export`)" download>导出</a><button @click="bookmark">{{ detail.progress.bookmarked_page_ids.includes(pageId) ? '取消书签' : '加入书签' }}</button></div></div><button v-if="page.status === 'pending' && detail.book.can_edit" class="primary" :disabled="busy" @click="compilePage">生成本章</button><article v-for="(block, blockIndex) in page.blocks" :key="block.id" class="book-block" :data-book-block-id="block.id"><div v-if="detail.book.can_edit" class="book-block-actions"><button @click="moveBlock(block, -1)">上移</button><button @click="moveBlock(block, 1)">下移</button><button @click="editBlock(block)">编辑</button><button @click="regenerateBlock(block)">重新生成</button><button @click="deleteBlock(block)">删除</button></div><form v-if="editingBlock === block.id" class="settings-form" @submit.prevent="updateBlock(block)"><input v-model="blockTitle" aria-label="块标题"><textarea v-model="blockBody" rows="8" aria-label="块内容" /><button class="primary" :disabled="busy">保存块</button></form><template v-else><h3 v-if="block.title">{{ block.title }}</h3><p v-if="block.status === 'error'" class="error">{{ block.error }}</p><img v-if="blockImage(block)" :src="blockImage(block)" :alt="block.title || '插图'" /><MarkdownView v-if="body(block)" :content="body(block)" /><fieldset v-if="block.type === 'quiz'"><legend>{{ String(block.payload.question || block.title || '问题') }}</legend><label v-for="[key, value] in blockOptions(block)" :key="key"><input v-model="answers[block.id]" type="radio" :name="`quiz-${block.id}`" :value="key">{{ key }}. {{ value }}</label><button :disabled="!answers[block.id]" @click="answerQuiz(block)">提交答案</button><p v-if="quizResults[block.id] !== undefined">{{ quizResults[block.id] ? '回答正确' : '还需再练习' }}</p></fieldset><details v-if="!body(block) && !blockImage(block) && block.type !== 'quiz'"><summary>{{ block.type }} 内容</summary><pre>{{ JSON.stringify(block.payload, null, 2) }}</pre></details></template></article></template><p v-else class="muted">从左侧选择章节。</p><div v-if="page && page.blocks.length" class="book-selection-actions"><button type="button" :disabled="busy" @click="captureSelection">✎ 保存选中内容</button></div>
<section v-if="captures.length" class="book-capture-panel" aria-label="已保存高亮">
  <header><button type="button" :aria-expanded="capturesOpen" @click="capturesOpen = !capturesOpen">⌄ 已保存高亮 <small>{{ reviewableCaptures.length ? `${reviewableCaptures.length} 条待确认` : `${captures.length} 条已保存` }}</small></button><button v-if="capturesOpen" type="button" @click="showAllCaptures = !showAllCaptures">{{ showAllCaptures ? '待审核' : '全部' }}</button></header>
  <template v-if="capturesOpen"><p v-if="capturesLoading && !visibleCaptures.length" class="muted">正在加载高亮…</p><p v-else-if="!visibleCaptures.length" class="muted">没有待确认的高亮，切换到“全部”查看已保存内容。</p><div v-else class="book-capture-list"><article v-for="capture in visibleCaptures" :key="capture.id"><header><span>{{ capture.status }}</span><small>{{ capture.chapter_title || '未知章节' }}</small></header><p>{{ capture.source_text }}</p><small v-if="capture.user_note">备注：{{ capture.user_note }}</small><footer v-if="REVIEWABLE_STATUSES.has(capture.status)"><button class="primary" :disabled="busy" @click="updateCapture(capture, 'approved')">✓ 确认</button><button :disabled="busy" @click="updateCapture(capture, 'rejected')">× 忽略</button></footer></article></div><p v-if="reviewableCaptures.length" class="book-capture-hint">选中的文字会先保存在这里，确认后可导出到 MarginNote。</p></template>
</section>
<section class="book-block-editor"><h3>添加内容块</h3><div class="partner-actions"><select v-model="newBlockType" aria-label="块类型"><option value="paragraph">段落</option><option value="heading">标题</option><option value="quote">引用</option><option value="code">代码</option><option value="quiz">测验</option></select><input v-model="blockTitle" aria-label="新块标题" placeholder="标题"><button :disabled="busy" @click="insertBlock">插入并生成</button></div><textarea v-model="blockBody" aria-label="新块内容" rows="4" placeholder="内容（可选）" /></section><section class="book-supplement"><label>补充当前主题<input v-model="supplementTopic" placeholder="需要补充的内容"><button :disabled="busy || !supplementTopic.trim()" @click="supplement(false)">生成补充</button></label><label>深入学习子章节<input v-model="deepTopic" placeholder="子章节主题"><button :disabled="busy || !deepTopic.trim()" @click="supplement(true)">创建子章节</button></label></section></section><div v-if="page" class="book-outline-nav"><button type="button" class="book-outline-toggle" :aria-expanded="!outlineCollapsed" aria-label="本页内容目录" @click="outlineCollapsed = !outlineCollapsed">☷</button><nav v-if="!outlineCollapsed" aria-label="本页内容目录"><header><strong>本页内容</strong><button aria-label="收起目录" @click="outlineCollapsed = true">›</button></header><ol><li v-for="block in page.blocks" :key="block.id"><button :class="{ active: activeOutlineBlock === block.id }" @click="jumpToBlock(block.id)"><span>{{ block.title || body(block).slice(0, 32) || block.type }}</span><small v-if="block.status === 'error'">失败</small></button></li></ol></nav></div>
<footer v-if="page" class="book-page-footer"><RouterLink v-if="previousPage" :to="`/learning/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(previousPage.id)}`">← <span><small>上一章</small>{{ previousPage.title }}</span></RouterLink><span v-else></span><div><small>← / → 翻页</small><progress max="100" :value="detail.book.reading?.percent || 0"></progress></div><RouterLink v-if="nextPage" :to="`/learning/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(nextPage.id)}`"><span><small>下一章</small>{{ nextPage.title }}</span> →</RouterLink><span v-else></span></footer></div></div></div>
    </template>
  </main>
</template>
