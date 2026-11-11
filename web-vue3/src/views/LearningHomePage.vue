<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { allLearningActivity, learningTodos, type LearningKind, type LearningSources } from '../learningActivity'
import { setMasteryOpeningPrompt } from '../pendingPrompt'
import { scopedUrl } from '../workspaceScope'
import LearningWays from '../components/LearningWays.vue'
import LegacyIcon from '../components/LegacyIcon.vue'

const EMPTY: LearningSources = { books: [], mastery: [], reading: [], watching: [], practice: [] }
const sources = ref<LearningSources>({ ...EMPTY })
const failed = ref<LearningKind[]>([])
const loading = ref(true)
const kind = ref<LearningKind | 'all'>('all')
const query = ref('')
const limit = ref(24)
const groups = [
  { kind: 'books', title: '书籍', description: '生成、浏览并学习你的 AI 编写书籍。', href: '/learning/books', icon: 'learning' },
  { kind: 'mastery', title: '精通之路', description: '沿着持续完善的知识图谱，逐步掌握一个主题。', href: '/learning/mastery', icon: 'resources' },
  { kind: 'practice', title: '练习', description: '管理题库、整理错题，每天巩固所学。', href: '/learning/practice', icon: 'questions' },
  { kind: 'reading', title: '沉浸式阅读', description: '在导师陪伴下，深入阅读你的资料。', href: '/learning/reading', icon: 'journal' },
] as const
let busy = false
let alive = true
let timer: ReturnType<typeof setInterval> | undefined

const todos = computed(() => learningTodos(sources.value))
const all = computed(() => allLearningActivity(sources.value))
const recent = computed(() => all.value.filter(item =>
  (kind.value === 'all' || item.kind === kind.value || (kind.value === 'reading' && item.kind === 'watching')) &&
  item.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const selectedSurface = computed(() => groups.find(group => group.kind === kind.value))
function kindTitle(value: LearningKind) { return value === 'watching' ? '沉浸阅读' : groups.find(group => group.kind === value)?.title || value }
function selectKind(value: LearningKind | 'all') { kind.value = value; limit.value = 24 }
function updateQuery(value: string) { query.value = value; limit.value = 24 }
function openReview(pathId: string, entry: LearningSources['mastery'][number]) {
  const due = (entry.reviews || []).filter(review => review.due).slice(0, 5).map(review => review.knowledge_point_name).filter(Boolean)
  setMasteryOpeningPrompt(due.length ? `今天一起复习到期内容：${due.join('、')}。` : '一起复习我已经学过的内容。')
  return scopedUrl(`/learning/mastery/${encodeURIComponent(pathId)}/sessions?mode=review`, entry.content_workspace_id || '')
}
async function refresh() {
  if (busy || document.visibilityState === 'hidden') return
  busy = true
  try {
    const payload = await api<{ sources: LearningSources; failed?: LearningKind[] }>('/api/dashboard/learning-index')
    const failures = payload.failed || []
    const next = {} as LearningSources
    for (const key of Object.keys(EMPTY) as LearningKind[]) {
      const rows = payload.sources?.[key] || []
      next[key] = failures.includes(key) && !rows.length ? sources.value[key] : rows
    }
    if (alive) { sources.value = next; failed.value = failures }
  } catch {
    if (alive) failed.value = Object.keys(EMPTY) as LearningKind[]
  } finally {
    if (alive) loading.value = false
    busy = false
  }
}
onMounted(() => {
  alive = true
  void refresh()
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)
  timer = setInterval(refresh, 30_000)
})
onUnmounted(() => {
  alive = false
  if (timer) clearInterval(timer)
  window.removeEventListener('focus', refresh)
  document.removeEventListener('visibilitychange', refresh)
})
</script>

<template>
  <main class="feature-page learning-home">
    <header class="learning-page-bar"><span class="dt-crumb is-feature"><LegacyIcon name="resources" :size="15" />全部学习</span><div><RouterLink class="learning-create" to="/learning/new"><LegacyIcon name="plus" :size="14" />新建学习</RouterLink><button type="button" class="legacy-sr-only" @click="refresh">刷新</button></div></header>
    <div class="learning-filter"><div role="group" aria-label="学习类型筛选"><button type="button" :aria-pressed="kind === 'all'" @click="selectKind('all')">全部学习</button><button v-for="group in groups" :key="group.kind" type="button" :aria-pressed="kind === group.kind" @click="selectKind(group.kind)">{{ group.title }}</button></div><input :value="query" aria-label="搜索学习记录" placeholder="搜索学习记录" @input="updateQuery(($event.target as HTMLInputElement).value)"></div>
    <RouterLink v-if="selectedSurface" class="text-button" :to="selectedSurface.href">打开{{ selectedSurface.title }} ↗</RouterLink>
    <LearningWays />
    <p v-if="failed.length" class="error" role="alert">部分学习资料暂时无法加载：{{ failed.map(kindTitle).join('、') }} <button type="button" @click="refresh">重试</button></p>
    <p v-if="loading" class="muted" role="status">加载中…</p>
    <template v-else>
      <section v-if="todos.reviews.length || todos.books.length" aria-labelledby="learning-todos"><h2 id="learning-todos">该做的事<span class="legacy-sr-only">需要你的关注</span></h2><div class="partner-grid">
        <RouterLink v-for="topic in todos.reviews" :key="`${topic.content_workspace_id}:${topic.path_id}`" class="learning-record-card" :to="openReview(String(topic.path_id), topic)"><strong>{{ topic.name || topic.metadata?.goal }}</strong><p>{{ topic.reviews?.filter(review => review.due).length }} 项复习已到期</p></RouterLink>
        <RouterLink v-for="book in todos.books" :key="`${book.content_workspace_id}:${book.id}`" class="learning-record-card" :to="`/learning/books/${encodeURIComponent(String(book.id))}`"><LegacyIcon name="learning" /><strong>{{ book.title }}</strong><p>{{ book.status === 'paused' ? '已暂停' : '编写中' }}<template v-if="book.status === 'paused' && book.metadata?.pause_reason"> · {{ book.metadata.pause_reason }}</template></p></RouterLink>
      </div></section>
      <section v-if="recent.length" aria-labelledby="learning-recent"><h2 id="learning-recent">最近活动</h2><div class="partner-grid"><RouterLink v-for="item in recent.slice(0, limit)" :key="item.key" :to="item.href" class="learning-record-card"><LegacyIcon :name="groups.find(group => group.kind === item.kind || (item.kind === 'watching' && group.kind === 'reading'))?.icon || 'learning'" /><div><strong>{{ item.title }}</strong><small>{{ kindTitle(item.kind) }}</small></div><span v-if="item.progress !== undefined" class="learning-progress-ring" :style="{ '--progress': `${Math.round(Math.max(0, Math.min(1, item.progress)) * 360)}deg` }" :aria-label="`${item.title} 学习进度`"><i>{{ Math.round(item.progress * 100) }}%</i></span><time :datetime="new Date(item.updatedAt * 1000).toISOString()">{{ new Date(item.updatedAt * 1000).toLocaleDateString('zh-CN') }}</time></RouterLink></div></section>
      <button v-if="recent.length > limit" type="button" @click="limit += 24">显示更多</button>
      <div v-if="!all.length && !failed.length" class="learning-empty"><h2>从这里开始新的学习旅程</h2><p>选择一本书、一个主题、一组资料或一段视频，开始学习。</p></div>
      <p v-else-if="!recent.length && !failed.length" class="muted">没有符合条件的学习记录。</p>
    </template>
  </main>
</template>
