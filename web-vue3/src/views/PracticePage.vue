<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api'
import PracticeImport from './PracticeImport.vue'
import PracticeInsights from './PracticeInsights.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import MarkdownView from '../components/MarkdownView.vue'
import {
  practiceMarkdown,
  practiceRefsFromQuery,
  practiceReviewProgress,
  practiceTimezone,
  type PracticeQuestion,
  type PracticeRating,
  type PracticeRef,
  type PracticeReviewResult,
  type PracticeSummary,
} from '../practice'

withDefaults(defineProps<{ library?: boolean }>(), { library: false })
const route = useRoute()
const router = useRouter()
const initialRefs = practiceRefsFromQuery(route.query as Record<string, unknown>)
const summary = ref<PracticeSummary | null>(null)
const queue = ref<PracticeRef[]>(initialRefs)
const index = ref(0)
const saved = ref(0)
const sessionTotal = ref(initialRefs.length)
const skipped = ref(0)
const nextDue = ref<number | null>(null)
const question = ref<PracticeQuestion | null>(null)
const answer = ref('')
const revealed = ref(false)
const correct = ref<boolean | null>(null)
const busy = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const importing = ref(false)
const revision = ref(0)
const conflict = ref(false)
let summaryVersion = 0
let questionVersion = 0
const submission = ref<{ request_id: string; version: number; rating: PracticeRating; answer: string; self_report?: boolean } | null>(null)
const current = computed(() => queue.value[index.value])
const complete = computed(() => queue.value.length > 0 && index.value >= queue.value.length)
const choices = computed(() => Object.entries(question.value?.entry.options || {}))
const multiple = computed(() => ['multi_choice', 'multiple_select'].includes(question.value?.entry.question_type || ''))
const categories = computed(() => question.value?.entry.categories || [])
const timezone = encodeURIComponent(practiceTimezone())
const root = '/api/question-notebook/practice'
function path(suffix: string, workspaceId?: string) { return `${root}${suffix}${workspaceId ? `${suffix.includes('?') ? '&' : '?'}dt_workspace=${encodeURIComponent(workspaceId)}` : ''}` }
async function refresh() {
  const version = ++summaryVersion
  try {
    const result = await api<PracticeSummary>(path(`/summary?timezone=${timezone}`))
    if (version === summaryVersion) { summary.value = result; error.value = '' }
  } catch (cause) { if (version === summaryVersion) error.value = String(cause instanceof Error ? cause.message : cause) }
}
async function loadQuestion() {
  const version = ++questionVersion
  question.value = null; answer.value = ''; revealed.value = false; correct.value = null; conflict.value = false; submission.value = null; error.value = ''
  if (!current.value) return
  try {
    const result = await api<PracticeQuestion>(path(`/questions/${current.value.id}`, current.value.workspaceId))
    if (!result?.entry) throw new Error('题目数据不完整，请稍后重试。')
    if (version === questionVersion) question.value = result
  }
  catch (cause) { if (version === questionVersion) error.value = String(cause instanceof Error ? cause.message : cause) }
}
watch(current, loadQuestion)
onMounted(() => {
  void refresh()
  if (initialRefs.length) void loadQuestion()
  if (route.query.create === '1') {
    importing.value = true
    const query = { ...route.query }
    delete query.create
    void router.replace({ path: route.path, query })
  }
})
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { if (!document.hidden) void refresh() }, 60000); window.addEventListener('focus', refresh) })
onUnmounted(() => { summaryVersion++; questionVersion++; if (timer) clearInterval(timer); window.removeEventListener('focus', refresh) })
async function start() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const items = await api<PracticeQuestion[]>(path(`/queue?timezone=${timezone}`))
    queue.value = items.map(item => ({
      id: item.entry.id,
      workspaceId: item.content_workspace_id || undefined,
      workspaceName: item.content_workspace_name || undefined,
    }))
    index.value = 0; saved.value = 0; skipped.value = 0; nextDue.value = null
    sessionTotal.value = items.length
    if (!items.length) { notice.value = '今天的复习已完成，下次到期时再来。'; void refresh() }
  } catch (cause) { error.value = String(cause instanceof Error ? cause.message : cause) }
  finally { busy.value = false }
}
function close() {
  if (busy.value) return
  queue.value = []; index.value = 0; sessionTotal.value = 0; saved.value = 0; skipped.value = 0; nextDue.value = null
  revision.value++; void refresh()
  if (route.query.question || route.query.questions) {
    const query = { ...route.query }
    delete query.question
    delete query.questions
    void router.replace({ path: route.path, query })
  }
}
function imported(message: string) { notice.value = message; importing.value = false; revision.value++; void refresh() }
function selectChoice(key: string) { const selected = answer.value.split(',').filter(Boolean); answer.value = multiple.value ? (selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key]).sort().join(',') : key }
async function reveal() {
  if (!current.value || busy.value) return
  busy.value = true; error.value = ''
  try { const result = await api<{ correct: boolean | null }>(path(`/questions/${current.value.id}/check`, current.value.workspaceId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: answer.value }) }); correct.value = result.correct; revealed.value = true }
  catch (cause) { error.value = String(cause instanceof Error ? cause.message : cause) }
  finally { busy.value = false }
}
async function rate(rating: PracticeRating, selfReport = false) {
  if (!current.value || !question.value || busy.value || conflict.value) return
  busy.value = true; saving.value = true; error.value = ''
  submission.value ||= { request_id: crypto.randomUUID(), version: question.value.state.version, rating, answer: answer.value, self_report: selfReport }
  try {
    const result = await api<PracticeReviewResult>(path(`/questions/${current.value.id}/review`, current.value.workspaceId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission.value) })
    const progress = practiceReviewProgress(queue.value, current.value, saved.value, nextDue.value, rating, result)
    queue.value = progress.queue
    saved.value = progress.saved
    nextDue.value = progress.nextDue
    index.value++
  }
  catch (cause) { error.value = String(cause instanceof Error ? cause.message : cause); conflict.value = cause instanceof ApiError && cause.status === 409 }
  finally { busy.value = false; saving.value = false }
}
function skip() { if (!busy.value && !conflict.value) { skipped.value++; index.value++ } }
function reloadOrRefresh() {
  if (current.value) void loadQuestion()
  else void refresh()
}
const ratingLabels: Record<PracticeRating, { label: string; description: string }> = {
  again: { label: '再练', description: '本轮再练一次' },
  hard: { label: '困难', description: '我需要提示' },
  good: { label: '掌握了', description: '过几天再复习' },
  easy: { label: '简单', description: '我很有把握' },
}
</script>

<template>
  <main class="feature-page practice-page">
    <header class="practice-page-bar"><span class="dt-crumb is-feature"><LegacyIcon name="questions" :size="15" />{{ library ? '题库' : '练习' }}</span><button v-if="!queue.length && !library" class="practice-import-button" :aria-expanded="importing" @click="importing = !importing"><LegacyIcon name="attachment" :size="14" />导入题目</button></header>
    <p v-if="error" class="error" role="alert">{{ error }} <button v-if="conflict || !question" @click="reloadOrRefresh">重新加载题目</button></p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <template v-if="!queue.length"><PracticeImport v-if="importing" @close="importing = false" @imported="imported" /><section class="practice-summary"><header><h2 id="review-today">今日复习</h2></header><div class="practice-due-body"><div><div class="practice-due"><strong>{{ summary?.due ?? '—' }}</strong><span>道题待复习</span></div><p>掌握一道，本轮就少一道；到了下次复习时间，它会再次出现。</p></div><button class="primary" :disabled="busy || !summary?.due" @click="start">开始今日复习</button></div><div class="practice-stats"><span><strong>{{ summary?.reviewed_today ?? '—' }}</strong><small>今日已复习</small></span><span><strong>{{ summary ? summary.total - summary.due : '—' }}</strong><small>等待下次复习</small></span><span><strong>{{ summary?.total ?? '—' }}</strong><small>题库</small></span></div></section><div class="practice-summary-footer"><p>先回忆，再看答案。没记住的题，本轮会再练一次。</p><RouterLink to="/space/questions">▥ 管理题库 →</RouterLink></div><details class="practice-insights-disclosure"><summary>练习统计 <span>⌄</span></summary><PracticeInsights :revision="revision" /></details></template>
    <template v-else><div class="practice-session-header"><button :disabled="busy" @click="close">← {{ library ? '返回题库' : '返回练习' }}</button><span>{{ Math.max(0, sessionTotal - saved - skipped) }} 道剩余</span></div><progress :max="sessionTotal || 1" :value="saved" aria-label="练习进度" />
      <section v-if="complete" class="practice-card"><h2>本组练习已完成</h2><h2 class="legacy-sr-only">练习完成</h2><p>已保存 {{ saved }} 次复习，下次复习日期已更新。<template v-if="skipped">；{{ skipped }} 道跳过的题目仍等待复习</template></p><p v-if="nextDue" class="muted">下次复习：{{ new Date(nextDue * 1000).toLocaleDateString('zh-CN') }}</p><button class="primary" @click="close">{{ library ? '返回题库' : '返回练习' }}</button></section>
      <section v-else class="practice-card"><p v-if="!question?.entry" role="status">正在加载题目…</p><template v-else><div class="practice-meta"><small>{{ question.entry.material_title || '练习' }}</small><span v-for="tag in categories" :key="tag.id" class="practice-tag">{{ tag.name }}</span></div><div class="practice-question"><MarkdownView :content="practiceMarkdown(question.entry.question)" /></div><p v-if="multiple" class="muted">选择所有正确答案</p><fieldset v-if="choices.length" :disabled="revealed || busy"><legend>你的答案</legend><label v-for="[key, value] in choices" :key="key" class="practice-choice"><input :type="multiple ? 'checkbox' : 'radio'" :name="`practice-${current?.id ?? 0}`" :checked="multiple ? answer.split(',').includes(key) : answer === key" @change="selectChoice(key)" /><strong>{{ key }}</strong><MarkdownView :content="practiceMarkdown(value)" /></label></fieldset><label v-else class="practice-answer">你的答案<textarea v-model="answer" :disabled="revealed || busy" maxlength="20000" rows="5" placeholder="先尝试回忆答案" /></label>
        <div v-if="!revealed" class="practice-actions"><button aria-hidden="true" class="legacy-sr-only" :disabled="busy" @click="reveal">核对并显示答案</button><button class="primary" aria-label="核对并显示答案" :disabled="busy" @click="reveal">提交并查看答案</button><button :disabled="busy" @click="rate('good', true)">我已掌握</button><button :disabled="busy" @click="skip">暂时跳过</button></div>
        <template v-else><div class="practice-reference"><strong>{{ correct === null ? '对照参考答案' : correct ? '正确' : '还需再练习' }}</strong><MarkdownView :content="question.entry.correct_answer || '未保存参考答案，请参照原始资料。'" /><MarkdownView v-if="question.entry.explanation" :content="question.entry.explanation" /></div><div class="practice-rating-area"><template v-if="correct === null"><h3>这次掌握得怎么样？</h3><p>掌握一道，本轮就少一道；到了下次复习时间，它会再次出现。</p><div class="practice-rating-grid"><button v-for="rating in (['again','hard','good','easy'] as const)" :key="rating" :aria-label="`${ratingLabels[rating].label} ${ratingLabels[rating].description}`" :disabled="busy || conflict || (!!submission && submission.rating !== rating)" @click="rate(rating)"><strong>{{ ratingLabels[rating].label }}</strong><small>{{ ratingLabels[rating].description }}</small></button></div></template><template v-else><div class="practice-next-rating"><button aria-hidden="true" class="legacy-sr-only" @click="rate('good')">已掌握</button><p>{{ correct ? '掌握一道，本轮就少一道；到了下次复习时间，它会再次出现。' : '本题会在本轮再练一次。' }}</p><button class="primary" :aria-label="correct ? '已掌握' : '本轮再练一次'" :disabled="busy || conflict" @click="rate(correct ? 'good' : 'again')">{{ correct ? '已掌握 · 下一题' : '本轮再练一次' }}</button></div></template><p v-if="saving" role="status" class="practice-saving">正在保存复习…</p></div></template>
      </template></section>
    </template>
  </main>
</template>
