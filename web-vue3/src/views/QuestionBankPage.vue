<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'
import PracticeImport from './PracticeImport.vue'
import PracticePage from './PracticePage.vue'
import CategoryMenu from '../components/CategoryMenu.vue'
import MarkdownView from '../components/MarkdownView.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import { practiceRefsFromQuery, practiceTimezone, type PracticeSummary } from '../practice'

interface Category { id: number; name: string; entry_count: number }
interface Question { id: number; question: string; options: Record<string, string>; correct_answer: string; explanation: string; user_answer: string; source: string; material_id?: string; material_title: string; mastery_path_id?: string; session_id: string; session_title: string; content_workspace_id?: string; is_correct: boolean; resolved: boolean; bookmarked: boolean; score_trend?: string; categories: Category[] | null; created_at: number; difficulty?: string; question_type?: string; assessment_type?: string; section_id?: string; section_title?: string; followup_session_id?: string; origin_ref?: string; practice?: { is_mistake?: boolean; review_count?: number; last_answer?: string; last_rating?: string; due_at?: number } }
interface Stats { total: number; wrong: number; unresolved: number; bookmarked: number; uncategorized: number }
interface Material { source: string; material_id: string; material_title: string; entry_count: number; unresolved_count: number }
const route = useRoute()
const router = useRouter()
const items = ref<Question[]>([])
const categories = ref<Category[]>([])
const materials = ref<Material[]>([])
const stats = ref<Stats>({ total: 0, wrong: 0, unresolved: 0, bookmarked: 0, uncategorized: 0 })
const scope = ref(String(route.query.view) === 'mistakes' ? 'wrong' : 'all')
const sourceFilter = ref('')
const materialFilter = ref('')
const trendFilter = ref('')
const search = ref('')
const committedSearch = ref('')
const sort = ref<'recent' | 'oldest'>('recent')
const page = ref(0)
const total = ref(0)
const selected = ref<number[]>([])
const newCategory = ref('')
const renamingId = ref<number | null>(null)
const renameValue = ref('')
const expanded = ref<number[]>([])
const loading = ref(false)
const refreshing = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const importing = ref(String(route.query.create) === '1')
const managerOpen = ref(false)
const questionMenuOpen = ref(false)
const practiceSummary = ref<PracticeSummary | null>(null)
const pageSize = 60
let entriesVersion = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const practiceRefs = computed(() => practiceRefsFromQuery(route.query as Record<string, unknown>))
const practiceKey = computed(() => practiceRefs.value.map(item => `${item.workspaceId || ''}:${item.id}`).join(','))
const collection = computed(() => scope.value === 'wrong' ? 'mistakes' : 'bank')
const materialOptions = computed(() => materials.value.filter(item => !sourceFilter.value || item.source === sourceFilter.value))
function params() {
  const value = new URLSearchParams({ limit: String(pageSize), offset: String(page.value * pageSize), sort: sort.value })
  if (committedSearch.value) value.set('search', committedSearch.value)
  if (sourceFilter.value) value.set('source', sourceFilter.value)
  if (materialFilter.value) value.set('material_id', materialFilter.value)
  if (trendFilter.value) value.set('score_trend', trendFilter.value)
  if (scope.value === 'wrong' || scope.value === 'unresolved') value.set('is_correct', 'false')
  if (collection.value === 'mistakes') value.set('mistakes_only', 'true')
  if (scope.value === 'unresolved') value.set('resolved', 'false')
  if (scope.value === 'bookmarked') value.set('bookmarked', 'true')
  if (scope.value === 'uncategorized') value.set('uncategorized', 'true')
  if (scope.value.startsWith('category:')) value.set('category_id', scope.value.slice(9))
  return value
}
async function loadEntries() {
  const version = ++entriesVersion
  loading.value = true
  refreshing.value = items.value.length > 0
  error.value = ''
  try {
    const result = await api<{ items: Question[]; total: number }>(`/api/question-notebook/entries?${params()}`)
    if (version !== entriesVersion) return
    if (!result.items.length && page.value > 0 && result.total > 0) { page.value--; return }
    items.value = result.items
    total.value = result.total
    selected.value = selected.value.filter(id => result.items.some(item => item.id === id))
  } catch (cause) { if (version === entriesVersion) error.value = cause instanceof Error ? cause.message : '题目加载失败' }
  finally { if (version === entriesVersion) { loading.value = false; refreshing.value = false } }
}
async function loadMeta() {
  const timezone = encodeURIComponent(practiceTimezone())
  const [categoryResult, statsResult, materialResult, summaryResult] = await Promise.allSettled([api<Category[]>('/api/question-notebook/categories'), api<Stats>('/api/question-notebook/stats'), api<Material[]>('/api/question-notebook/materials'), api<PracticeSummary>(`/api/question-notebook/practice/summary?timezone=${timezone}`)])
  if (categoryResult.status === 'fulfilled') categories.value = categoryResult.value
  if (statsResult.status === 'fulfilled') stats.value = statsResult.value
  if (materialResult.status === 'fulfilled') materials.value = materialResult.value
  if (summaryResult.status === 'fulfilled' && typeof summaryResult.value.mistakes === 'number') practiceSummary.value = summaryResult.value
  if ([categoryResult, statsResult, materialResult].every(result => result.status === 'rejected')) error.value = '题库统计加载失败'
}
async function refresh() { await Promise.all([loadEntries(), loadMeta()]) }
onMounted(loadMeta)
watch([scope, sort, page, committedSearch, sourceFilter, materialFilter, trendFilter], loadEntries, { immediate: true })
watch(scope, () => { page.value = 0; selected.value = [] })
watch([sourceFilter, materialFilter, trendFilter, sort], () => { page.value = 0; selected.value = [] })
watch(sourceFilter, () => { if (materialFilter.value && !materialOptions.value.some(item => item.material_id === materialFilter.value)) materialFilter.value = '' })
watch(search, value => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { committedSearch.value = value.trim(); page.value = 0 }, 250) })
onUnmounted(() => { entriesVersion++; if (searchTimer) clearTimeout(searchTimer) })
async function mutate(action: () => Promise<unknown>, message: string) {
  busy.value = true
  error.value = ''
  notice.value = ''
  try { await action(); await refresh(); notice.value = message; return true }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败'; return false }
  finally { busy.value = false }
}
function patchEntry(id: number, body: unknown) { return api(`/api/question-notebook/entries/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
function toggleBookmark(item: Question) { void mutate(() => patchEntry(item.id, { bookmarked: !item.bookmarked }), item.bookmarked ? '已取消收藏' : '已收藏') }
function toggleResolved(item: Question) { void mutate(() => patchEntry(item.id, { resolved: !item.resolved }), item.resolved ? '已恢复待复习' : '已标记解决') }
function remove(item: Question) { if (confirm('删除这道题？')) void mutate(() => api(`/api/question-notebook/entries/${item.id}`, { method: 'DELETE' }), '题目已删除') }
function select(id: number) { selected.value = selected.value.includes(id) ? selected.value.filter(item => item !== id) : [...selected.value, id] }
function selectAll() { selected.value = selected.value.length === items.value.length ? [] : items.value.map(item => item.id) }
function syncExpanded(id: number, event: Event) { const open = (event.currentTarget as HTMLDetailsElement).open; expanded.value = open ? [...new Set([...expanded.value, id])] : expanded.value.filter(item => item !== id) }
function file(ids: number[], categoryId: number, link = true) {
  if (!ids.length) return Promise.resolve(false)
  return mutate(() => post('/api/question-notebook/entries/categories/bulk', { entry_ids: ids, category_id: categoryId, link }), '分类已更新')
}
function fileIntoNewCategory(ids: number[], rawName: string) {
  const name = rawName.trim()
  if (!name) return Promise.resolve(false)
  return mutate(async () => {
    let category = categories.value.find(item => item.name === name)
    if (!category) category = await post<Category>('/api/question-notebook/categories', { name })
    if (ids.length) await post('/api/question-notebook/entries/categories/bulk', { entry_ids: ids, category_id: category.id, link: true })
  }, '分类已更新')
}
async function fileSelected(categoryId: number) {
  const ok = await file(selected.value, categoryId)
  if (ok) selected.value = []
  return ok
}
async function fileSelectedIntoNewCategory(name: string) {
  const ok = await fileIntoNewCategory(selected.value, name)
  if (ok) selected.value = []
  return ok
}
async function unfileSelectedFromCurrent() {
  if (!scope.value.startsWith('category:')) return false
  const ok = await file(selected.value, Number(scope.value.slice(9)), false)
  if (ok) selected.value = []
  return ok
}
function createCategory() {
  const name = newCategory.value.trim()
  if (!name) return
  void mutate(async () => { await post('/api/question-notebook/categories', { name }); newCategory.value = '' }, '分类已创建')
}
function startRename(category: Category) {
  renamingId.value = category.id
  renameValue.value = category.name
}
async function commitRename(category: Category) {
  const name = renameValue.value.trim()
  if (name && name !== category.name) {
    await mutate(() => api(`/api/question-notebook/categories/${category.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }), '分类已重命名')
  }
  renamingId.value = null
  renameValue.value = ''
}
function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}
function deleteCategory(category: Category) { if (confirm(`删除分类“${category.name}”？题目会保留。`)) void mutate(async () => { await api(`/api/question-notebook/categories/${category.id}`, { method: 'DELETE' }); if (scope.value === `category:${category.id}`) scope.value = 'all' }, '分类已删除') }
function originRoute(item: Question) {
  const id = encodeURIComponent(item.session_id)
  let path = `/chat/${id}`
  if (item.source === 'mastery_path' && item.mastery_path_id) path = `/learning/mastery/${encodeURIComponent(item.mastery_path_id)}/sessions/${id}`
  else if (item.source === 'immersive_reading' && item.material_id) path = `/learning/reading/${encodeURIComponent(item.material_id)}/sessions/${id}`
  else if (item.source === 'book' && item.material_id) path = `/learning/books/${encodeURIComponent(item.material_id)}?chat=${id}`
  return scopedUrl(path, item.content_workspace_id || '')
}
function switchCollection(view: 'bank' | 'mistakes') {
  scope.value = view === 'mistakes' ? 'wrong' : 'all'
  const query = { ...route.query, view } as Record<string, string>
  delete query.question
  void router.replace({ path: '/space/questions', query })
}
function practiceVisible() {
  const ids = selected.value.length ? selected.value : items.value.map(item => item.id)
  if (!ids.length) return
  const query: Record<string, string> = { ...route.query, questions: ids.join(',') }
  delete query.create
  delete query.question
  void router.push({ path: '/space/questions', query })
}
function startPractice(item: Question) {
  const query: Record<string, string> = { ...route.query, question: String(item.id) } as Record<string, string>
  delete query.create
  if (item.content_workspace_id) query.dt_workspace = item.content_workspace_id
  void router.push({ path: '/space/questions', query })
}
function imported(message: string) { importing.value = false; notice.value = message; void refresh() }

const sourceLabels: Record<string, string> = { deep_question: '深度提问', mastery_path: '掌握路径', immersive_reading: '沉浸阅读', book: '书籍', partner_chat: '伙伴对话', import: '导入' }
const questionTypeLabels: Record<string, string> = { choice: '单选题', single_choice: '单选题', multiple_choice: '单选题', multi_choice: '多选题', true_false: '判断题', fill_in_blank: '填空题', fill_blank: '填空题', short: '简答题', short_answer: '简答题', free_response: '简答题', written: '写作题', essay: '写作题', concept: '概念题', coding: '编程题', open: '简答题' }
const assessmentLabels: Record<string, string> = { quiz: '测验', focus_check: '重点检查', qualitative: '定性', review: '复习' }
function questionResult(item: Question) {
  if (item.is_correct) return 'correct'
  if (item.user_answer?.trim()) return 'incorrect'
  return 'neutral'
}
function resultBadge(item: Question) {
  const result = questionResult(item)
  return result === 'correct' ? '正确' : result === 'incorrect' ? '答错' : '未作答'
}
function optionIsAnswer(key: string, value: string, answer: string) {
  const normalized = answer.trim().replace(/[。．]$/, '')
  return normalized === key || normalized === `${key}.` || normalized === value.trim()
}
function hasOptions(item: Question) { return Object.keys(item.options || {}).length > 0 }
function hasConversationSession(item: Question) {
  return Boolean(item.session_id && !item.session_id.startsWith('reading-notebook:') && !item.session_id.startsWith('partner-notebook:'))
}
function showReviewState(item: Question) { return Boolean(item.practice?.is_mistake || collection.value === 'mistakes' || questionResult(item) !== 'correct') }
function independentProvenance(item: Question) {
  if (hasConversationSession(item) || item.source === 'book' || item.source === 'immersive_reading' || item.source === 'mastery_path') return ''
  return item.material_title || item.origin_ref || (item.source === 'partner_chat' ? item.session_title : '') || ''
}
function answerVisible(item: Question) { return expanded.value.includes(item.id) }

const trendLabel = (value?: string) => ({ new: '首次作答', improved: '已提升', declined: '已下降', unchanged: '无变化' } as Record<string, string>)[value || ''] || ''
</script>

<template>
  <PracticePage v-if="practiceRefs.length" :key="practiceKey" library />
  <main v-else class="feature-page question-layout">
    <nav class="question-page-bar" aria-label="位置">
      <div class="question-crumb-wrap"><button type="button" class="question-crumb" aria-haspopup="menu" :aria-expanded="questionMenuOpen" @click.stop="questionMenuOpen = !questionMenuOpen" @keydown.esc="questionMenuOpen = false"><span aria-hidden="true">☑</span>题库</button><template v-if="questionMenuOpen"><div class="question-menu-dismiss" @click="questionMenuOpen = false"></div><div class="question-resource-menu" role="menu" aria-label="资料"><p>资料</p><RouterLink role="menuitem" to="/space" @click="questionMenuOpen = false">全部资料</RouterLink><RouterLink role="menuitem" to="/space/chat-history" @click="questionMenuOpen = false">聊天历史</RouterLink><RouterLink role="menuitem" to="/notebooks" @click="questionMenuOpen = false">收藏夹</RouterLink><RouterLink role="menuitem" to="/space/journal" @click="questionMenuOpen = false">学习日志</RouterLink><RouterLink role="menuitem" class="is-active" to="/space/questions" @click="questionMenuOpen = false">题库</RouterLink><RouterLink role="menuitem" to="/knowledge-bases" @click="questionMenuOpen = false">知识中心</RouterLink></div></template></div>
      <button type="button" class="question-import-button" :aria-expanded="importing" @click="importing = !importing"><span aria-hidden="true">⇱</span>导入题目</button>
    </nav>
    <div class="question-page-content">
      <header class="question-page-header"><span class="question-page-icon" aria-hidden="true">☑</span><div><h1>题库</h1><p>各个学习场景的题目与自己的导入题目，在这里统一管理。</p></div><button type="button" class="question-import-button" :aria-expanded="importing" @click="importing = !importing"><span aria-hidden="true">⇱</span>导入题目</button></header>
      <p v-if="notice" class="question-notice" role="status">✓ {{ notice }}</p>
      <PracticeImport v-if="importing" :key="collection" :initial-target="collection" @close="importing = false" @imported="imported" />
      <div v-if="error" class="question-error" role="alert"><span>{{ error }}</span><button type="button" @click="refresh">重试</button></div>
      <div class="question-tabs" role="tablist" aria-label="练习集合">
        <button id="practice-tab-bank" type="button" role="tab" :aria-selected="collection === 'bank'" aria-controls="practice-collection" @click="switchCollection('bank')">题库 <span>{{ stats.total }}</span></button>
        <button id="practice-tab-mistakes" type="button" role="tab" :aria-selected="collection === 'mistakes'" aria-controls="practice-collection" @click="switchCollection('mistakes')">错题 <span>{{ practiceSummary?.mistakes ?? stats.wrong }}</span></button>
      </div>
      <div id="practice-collection" role="tabpanel" :aria-labelledby="collection === 'bank' ? 'practice-tab-bank' : 'practice-tab-mistakes'">
        <div class="question-collection-intro"><p>{{ collection === 'mistakes' ? '复习后仍保留错题记录。标记为已解决，可以暂停这道题的每日复习。' : '各个学习场景的题目与自己的导入题目，在这里统一管理。' }}</p><button type="button" :disabled="loading || refreshing || !items.length" @click="practiceVisible">{{ selected.length ? `练习所选（${selected.length}）` : '练习本页题目' }}</button></div>
        <div class="question-toolbar">
          <label class="question-search"><span aria-hidden="true"><LegacyIcon name="search" :size="14" /></span><input v-model="search" type="search" aria-label="搜索题目" placeholder="搜索题目和答案…"><button v-if="search" type="button" class="question-search-clear" aria-label="清除搜索" @click="search = ''">×</button></label>
          <button type="button" class="question-sort" :class="{ 'is-refreshing': refreshing }" :aria-label="sort === 'recent' ? '最新在前' : '最早在前'" @click="sort = sort === 'recent' ? 'oldest' : 'recent'"><span aria-hidden="true"><LegacyIcon name="arrowDownUp" :size="14" /></span>{{ sort === 'recent' ? '最新在前' : '最早在前' }}</button>
          <select v-model="sourceFilter" aria-label="题目来源"><option value="">全部来源</option><option value="deep_question">深度提问</option><option value="mastery_path">精通之路</option><option value="immersive_reading">沉浸式阅读</option><option value="book">书籍</option><option value="partner_chat">伙伴对话</option><option value="import">已导入</option></select>
          <select v-model="materialFilter" aria-label="学习材料"><option value="">全部材料</option><option v-for="material in materialOptions" :key="`${material.source}:${material.material_id}`" :value="material.material_id">{{ material.material_title }}</option></select>
          <select v-model="trendFilter" aria-label="成绩趋势"><option value="">全部趋势</option><option value="new">首次作答</option><option value="improved">已提升</option><option value="declined">已下降</option><option value="unchanged">无变化</option></select>
          <button type="button" class="question-manager-toggle" :aria-expanded="managerOpen" @click="managerOpen = !managerOpen"><span aria-hidden="true"><LegacyIcon name="slidersHorizontal" :size="14" /></span>管理标签</button>
        </div>
        <section v-if="managerOpen" class="question-category-manager" aria-label="分类管理">
          <div v-for="category in categories" :key="category.id" class="question-category-row">
            <template v-if="renamingId === category.id">
              <input v-model="renameValue" aria-label="重命名分类" @keydown.esc="cancelRename">
              <button type="button" aria-label="保存" :disabled="busy || !renameValue.trim()" @click="commitRename(category)">✓</button>
              <button type="button" aria-label="取消" :disabled="busy" @click="cancelRename">×</button>
            </template>
            <template v-else>
              <span class="question-category-name">{{ category.name }} <small>{{ category.entry_count }}</small></span>
              <button type="button" aria-label="改名" :disabled="busy" @click="startRename(category)">✎</button>
              <button type="button" aria-label="删除" :disabled="busy" @click="deleteCategory(category)">⌫</button>
            </template>
          </div>
          <p v-if="!categories.length">暂无分类。</p>
          <form @submit.prevent="createCategory"><input v-model="newCategory" aria-label="分类名称" placeholder="新分类名称…"><button :disabled="!newCategory.trim" aria-label="添加分类">＋</button></form>
        </section>
        <div class="question-scope-row">
          <button type="button" :aria-pressed="scope === 'all'" @click="scope = 'all'"><span aria-hidden="true"><LegacyIcon name="resources" :size="14" /></span>全部</button>
          <button type="button" :aria-pressed="scope === 'bookmarked'" @click="scope = 'bookmarked'"><span aria-hidden="true"><LegacyIcon name="bookmark" :size="14" /></span>已标记</button>
          <button type="button" :aria-pressed="scope === 'uncategorized'" @click="scope = 'uncategorized'"><span aria-hidden="true"><LegacyIcon name="archive" :size="14" /></span>未分类</button>
          <template v-if="categories.length"><i></i><button v-for="category in categories" :key="category.id" type="button" :aria-pressed="scope === `category:${category.id}`" @click="scope = `category:${category.id}`"><span aria-hidden="true"><LegacyIcon name="folder" :size="14" /></span>{{ category.name }}</button></template>
        </div>
        <div v-if="loading && !items.length" class="question-empty"><span class="question-loading">◌</span><p>加载中…</p></div>
        <div v-else-if="!items.length" class="question-empty"><span aria-hidden="true"><LegacyIcon name="note" :size="18" /></span><h2>{{ committedSearch ? '没有匹配的题目' : scope === 'uncategorized' ? '全部已归类' : stats.total === 0 ? '暂无题目' : '当前视图暂无题目' }}</h2><p>{{ committedSearch ? '换个关键词，或清空搜索查看全部。' : scope === 'uncategorized' ? '没有待归类的题目了。' : stats.total === 0 ? '测验中的题目将汇总到此处。' : '切换筛选条件查看其他题目。' }}</p></div>
        <div v-else class="question-results" :class="{ 'is-refreshing': refreshing }">
          <article
            v-for="item in items"
            :key="item.id"
            class="question-card"
            :class="{ 'is-selected': selected.includes(item.id), 'is-disabled': busy }"
          >
            <div class="question-card-top">
              <input
                class="question-select-input"
                type="checkbox"
                aria-label="选择"
                :checked="selected.includes(item.id)"
                :disabled="busy"
                @change="select(item.id)"
              >
              <div class="question-badges">
                <span class="question-badge" :class="`question-badge-${questionResult(item)}`">{{ resultBadge(item) }}</span>
                <span v-if="item.difficulty" class="question-badge question-badge-muted">{{ item.difficulty }}</span>
                <span v-if="item.question_type" class="question-badge question-badge-muted">{{ questionTypeLabels[item.question_type] || item.question_type }}</span>
                <span class="question-badge question-badge-muted">{{ sourceLabels[item.source] || item.source }}</span>
                <span v-if="item.assessment_type && assessmentLabels[item.assessment_type]" class="question-badge question-badge-muted">{{ assessmentLabels[item.assessment_type] }}</span>
                <span v-if="trendLabel(item.score_trend)" class="question-badge question-badge-muted">{{ trendLabel(item.score_trend) }}</span>
                <span v-if="showReviewState(item)" class="question-badge" :class="item.resolved ? 'question-badge-resolved' : 'question-badge-review'">{{ item.resolved ? '已解决' : '待复习' }}</span>
              </div>
              <div class="question-card-tools">
                <CategoryMenu :categories="categories" :active-ids="(item.categories || []).map(category => category.id)" :disabled="busy" :on-pick="(id: number) => file([item.id], id)" :on-unpick="(id: number) => file([item.id], id, false)" :on-create="(name: string) => fileIntoNewCategory([item.id], name)" />
                <button type="button" class="question-icon-button" :class="{ 'is-bookmarked': item.bookmarked }" :aria-label="item.bookmarked ? '取消收藏' : '收藏'" :title="item.bookmarked ? '取消收藏' : '收藏'" :disabled="busy" @click="toggleBookmark(item)">{{ item.bookmarked ? '♥' : '♡' }}</button>
                <button v-if="showReviewState(item)" type="button" class="question-icon-button" :class="{ 'is-resolved': item.resolved }" :aria-label="item.resolved ? '恢复待复习' : '标记解决'" :title="item.resolved ? '恢复待复习' : '标记解决'" :disabled="busy" @click="toggleResolved(item)">{{ item.resolved ? '↺' : '✓✓' }}</button>
                <button type="button" class="question-icon-button question-delete-button" aria-label="删除" title="删除" :disabled="busy" @click="remove(item)">⌫</button>
              </div>
            </div>

            <div class="question-stem" data-testid="question-stem"><MarkdownView :content="item.question" /></div>
            <div class="question-content-indent">
              <div v-if="hasOptions(item)" class="question-options">
                <div
                  v-for="(value, key) in item.options"
                  :key="key"
                  class="question-option"
                  :class="{
                    'is-correct': answerVisible(item) && optionIsAnswer(String(key), value, item.correct_answer || ''),
                    'is-wrong': answerVisible(item) && questionResult(item) === 'incorrect' && optionIsAnswer(String(key), value, item.user_answer || '') && !optionIsAnswer(String(key), value, item.correct_answer || ''),
                  }"
                >
                  <strong>{{ key }}.</strong>
                  <div class="question-option-body"><MarkdownView :content="value" /></div>
                  <span v-if="answerVisible(item) && optionIsAnswer(String(key), value, item.correct_answer || '')" class="question-option-result">✓ 正确</span>
                  <span v-else-if="answerVisible(item) && questionResult(item) === 'incorrect' && optionIsAnswer(String(key), value, item.user_answer || '')" class="question-option-result is-wrong">✗ 我的选择</span>
                </div>
              </div>

              <details class="question-answer" :open="expanded.includes(item.id)" @toggle="syncExpanded(item.id, $event)">
                <summary>答案与解析</summary>
                <div v-if="!hasOptions(item)" class="question-answer-grid">
                  <div class="question-answer-block" :class="`question-answer-${questionResult(item)}`">
                    <h4>我的回答{{ questionResult(item) === 'correct' ? ' ✓' : questionResult(item) === 'incorrect' ? ' ✗' : '' }}</h4>
                    <MarkdownView v-if="item.user_answer" :content="item.user_answer" />
                    <span v-else class="question-answer-empty">—</span>
                  </div>
                  <div class="question-answer-block question-answer-correct">
                    <h4>参考答案</h4>
                    <MarkdownView v-if="item.correct_answer" :content="item.correct_answer" />
                    <span v-else class="question-answer-empty">—</span>
                  </div>
                </div>
                <div v-if="item.explanation" class="question-explanation">
                  <h4>解析</h4>
                  <MarkdownView :content="item.explanation" />
                </div>
                <div v-if="item.practice?.review_count" class="question-answer-block question-answer-neutral">
                  <h4>最近一次练习回答</h4>
                  <MarkdownView v-if="item.practice.last_answer" :content="item.practice.last_answer" />
                  <span v-else class="question-answer-empty">—</span>
                </div>
              </details>

              <div class="question-card-footer">
                <div class="question-tags">
                  <span v-for="category in item.categories || []" :key="category.id" class="question-tag">
                    {{ category.name }}
                    <button type="button" aria-label="移出分类" :disabled="busy" @click="file([item.id], category.id, false)">×</button>
                  </span>
                  <RouterLink v-if="hasConversationSession(item) && item.source !== 'import'" class="question-origin" :to="originRoute(item)">↗ {{ item.session_title || '原对话' }}</RouterLink>
                  <span v-if="independentProvenance(item)" class="question-provenance">{{ independentProvenance(item) }}</span>
                  <span v-if="item.source === 'mastery_path' && item.material_title" class="question-provenance">{{ item.material_title }}<template v-if="item.section_title"> · {{ item.section_title }}</template></span>
                  <span v-if="item.source === 'immersive_reading' && (item.material_title || item.section_title || item.material_id)" class="question-provenance">{{ item.section_title || item.material_title || item.material_id }}</span>
                  <RouterLink v-if="item.followup_session_id" class="question-origin" :to="`/chat/${encodeURIComponent(item.followup_session_id)}`">↗ 后续对话</RouterLink>
                </div>
                <div class="question-card-dates">
                  <span v-if="item.practice?.is_mistake && !item.resolved && item.practice.due_at">下次复习：{{ new Date(item.practice.due_at * 1000).toLocaleDateString() }}</span>
                  <time :datetime="new Date(item.created_at * 1000).toISOString()">{{ new Date(item.created_at * 1000).toLocaleString() }}</time>
                  <button type="button" class="question-practice-button" :disabled="busy" @click="startPractice(item)">练习此题</button>
                </div>
              </div>
            </div>
          </article>
        </div>
        <nav v-if="pageCount > 1" class="question-pages"><button :disabled="page === 0" @click="page--">上一页</button><span>第 {{ page + 1 }} / {{ pageCount }} 页</span><button :disabled="page + 1 >= pageCount" @click="page++">下一页</button></nav>
      </div>
      <button class="question-compat-select" aria-hidden="true" tabindex="-1" @click="selectAll">选择本页全部</button>
      <div v-if="selected.length" class="question-selection"><strong>已选 {{ selected.length }} 道题</strong><button v-if="selected.length < items.length" type="button" @click="selectAll">全选</button><CategoryMenu :categories="categories" :disabled="busy" label="加入分类" direction="up" align="left" variant="outlined" :on-pick="fileSelected" :on-create="fileSelectedIntoNewCategory" /><button v-if="scope.startsWith('category:')" class="question-unfile-selection" :disabled="busy" @click="unfileSelectedFromCurrent">移出分类</button><button aria-label="清除选择" @click="selected = []">×</button></div>
    </div>
  </main>
</template>
