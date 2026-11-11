<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import { api } from '../api'
import type { SelectedBookPage, SelectedBookReference } from '../bookReferences'

interface BookSummary { id: string; title: string; description?: string; page_count?: number; chapter_count?: number }
interface BookPage { id: string; title: string; chapter_id?: string; order?: number }
interface BookChapter { id: string; title: string; page_ids: string[]; order?: number }
interface BookDetail { pages: BookPage[]; spine?: { chapters: BookChapter[] } | null }
const props = withDefaults(defineProps<{ open: boolean; initial: SelectedBookReference[]; everyTurn?: boolean }>(), { everyTurn: false })
const emit = defineEmits<{ close: []; apply: [refs: SelectedBookReference[]]; 'update:everyTurn': [value: boolean] }>()
const books = ref<BookSummary[]>([])
const details = ref<Record<string, BookDetail>>({})
const activeBookId = ref('')
const query = ref('')
const selected = ref<SelectedBookReference[]>([])
const loadingBooks = ref(false)
const loadingDetail = ref(false)
const filteredBooks = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return keyword ? books.value.filter(book => `${book.title} ${book.description || ''}`.toLowerCase().includes(keyword)) : books.value
})
const activeBook = computed(() => books.value.find(book => book.id === activeBookId.value) || null)
const activeDetail = computed(() => activeBookId.value ? details.value[activeBookId.value] : undefined)
const pageGroups = computed(() => {
  const detail = activeDetail.value
  if (!detail) return []
  const byId = new Map(detail.pages.map(page => [page.id, page]))
  const used = new Set<string>()
  const groups: Array<{ chapter: BookChapter | null; pages: BookPage[] }> = (detail.spine?.chapters || []).map(chapter => {
    const pages = chapter.page_ids.map(id => byId.get(id)).filter((page): page is BookPage => Boolean(page))
    pages.forEach(page => used.add(page.id))
    return { chapter, pages }
  }).filter(group => group.pages.length)
  const orphan = detail.pages.filter(page => !used.has(page.id))
  if (orphan.length) groups.push({ chapter: null, pages: orphan })
  return groups
})
const selectedKeys = computed(() => new Set(selected.value.flatMap(book => book.pages.map(page => `${book.bookId}:${page.pageId}`))))
const selectedCount = computed(() => selected.value.reduce((total, ref) => total + ref.pages.length, 0))
function pageKey(bookId: string, pageId: string) { return `${bookId}:${pageId}` }
async function loadBooks() {
  loadingBooks.value = true
  try {
    const result = await api<{ books: BookSummary[] }>('/api/books')
    books.value = result.books || []
    activeBookId.value = books.value[0]?.id || ''
    if (activeBookId.value) await activateBook(activeBookId.value)
  } catch { books.value = [] } finally { loadingBooks.value = false }
}
async function activateBook(bookId: string) {
  activeBookId.value = bookId
  if (details.value[bookId]) return
  loadingDetail.value = true
  try { details.value = { ...details.value, [bookId]: await api<BookDetail>(`/api/books/${encodeURIComponent(bookId)}?include_blocks=false`) } }
  catch { details.value = { ...details.value, [bookId]: { pages: [], spine: null } } }
  finally { loadingDetail.value = false }
}
function togglePage(book: BookSummary, page: BookPage, chapter: BookChapter | null) {
  const existing = selected.value.find(ref => ref.bookId === book.id)
  if (existing?.pages.some(item => item.pageId === page.id)) {
    const pages = existing.pages.filter(item => item.pageId !== page.id)
    selected.value = pages.length ? selected.value.map(ref => ref.bookId === book.id ? { ...ref, pages } : ref) : selected.value.filter(ref => ref.bookId !== book.id)
    return
  }
  const nextPage: SelectedBookPage = { bookId: book.id, bookTitle: book.title, pageId: page.id, pageTitle: page.title || '未命名章节', chapterId: chapter?.id || page.chapter_id, chapterTitle: chapter?.title || page.title }
  selected.value = existing ? selected.value.map(ref => ref.bookId === book.id ? { ...ref, pages: [...ref.pages, nextPage] } : ref) : [...selected.value, { bookId: book.id, bookTitle: book.title, pages: [nextPage] }]
}
function toggleChapter(book: BookSummary, chapter: BookChapter | null, pages: BookPage[]) {
  const existing = selected.value.find(ref => ref.bookId === book.id)
  const allSelected = pages.every(page => selectedKeys.value.has(pageKey(book.id, page.id)))
  const existingPages = existing?.pages || []
  const nextPages = allSelected ? existingPages.filter(page => !pages.some(item => item.id === page.pageId)) : [...existingPages, ...pages.filter(page => !existingPages.some(item => item.pageId === page.id)).map(page => ({ bookId: book.id, bookTitle: book.title, pageId: page.id, pageTitle: page.title || '未命名章节', chapterId: chapter?.id || page.chapter_id, chapterTitle: chapter?.title || page.title }))]
  const others = selected.value.filter(ref => ref.bookId !== book.id)
  selected.value = nextPages.length ? [...others, { bookId: book.id, bookTitle: book.title, pages: nextPages }] : others
}
function togglePageForActive(page: BookPage, chapter: BookChapter | null) { if (activeBook.value) togglePage(activeBook.value, page, chapter) }
function toggleChapterForActive(chapter: BookChapter | null, pages: BookPage[]) { if (activeBook.value) toggleChapter(activeBook.value, chapter, pages) }
function close() { emit('close') }
function apply() { if (selected.value.length) { emit('apply', JSON.parse(JSON.stringify(selected.value))); close() } }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
watch(() => props.open, open => { if (open) { selected.value = JSON.parse(JSON.stringify(props.initial)); void loadBooks() } })
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template><Teleport to="body"><div v-if="open" class="picker-overlay" @click.self="close"><section class="book-picker" role="dialog" aria-modal="true" aria-labelledby="book-picker-title">
  <header><div class="picker-icon"><LegacyIcon name="book" :size="18" /></div><div><h2 id="book-picker-title">选择书籍章节</h2><p>选择生成书籍中的具体章节，为下一条回答提供依据。</p></div><ResourceReuseToggle :every-turn="everyTurn" @update:every-turn="emit('update:everyTurn', $event)" /><button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="18" /></button></header>
  <div class="book-picker-body"><aside><div class="picker-search"><LegacyIcon name="search" :size="15" /><input v-model="query" type="search" placeholder="搜索书籍" /></div><div v-if="loadingBooks" class="picker-loading"><span class="mastery-spinner" /></div><div v-else-if="!filteredBooks.length" class="picker-empty">没有找到书籍</div><button v-for="book in filteredBooks" :key="book.id" type="button" class="book-list-row" :class="{ active: book.id === activeBookId }" @click="activateBook(book.id)"><LegacyIcon name="book" :size="16" /><span><strong>{{ book.title || '未命名书籍' }}</strong><small>{{ book.page_count || 0 }} 页 · {{ book.chapter_count || 0 }} 章</small></span></button></aside>
    <main><div v-if="!activeBook" class="picker-empty">选择一本书查看章节</div><div v-else-if="loadingDetail && !activeDetail" class="picker-loading"><span class="mastery-spinner" /></div><template v-else><h3>{{ activeBook?.title }}</h3><p v-if="activeBook?.description" class="book-description">{{ activeBook?.description }}</p><div v-for="group in pageGroups" :key="group.chapter?.id || 'orphan'" class="book-chapter"><label><input type="checkbox" :checked="group.pages.every(page => selectedKeys.has(pageKey(activeBookId, page.id)))" @change="toggleChapterForActive(group.chapter, group.pages)" /><strong>{{ group.chapter?.title || '未分章页面' }}</strong></label><button v-for="page in group.pages" :key="page.id" type="button" class="book-page-row" :class="{ selected: selectedKeys.has(pageKey(activeBookId, page.id)) }" @click="togglePageForActive(page, group.chapter)"><span class="history-check"><LegacyIcon v-if="selectedKeys.has(pageKey(activeBookId, page.id))" name="check" :size="12" /></span>{{ page.title || '未命名章节' }}</button></div></template></main>
  </div><footer><span>已选择 {{ selectedCount }} 个页面</span><div><button type="button" @click="selected = []">清空</button><button type="button" class="primary" :disabled="!selectedCount" @click="apply">添加到消息</button></div></footer>
</section></div></Teleport></template>
