<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, post } from '../api'
import { setMasteryOpeningPrompt } from '../pendingPrompt'
import MasteryCreateWizard, { type WizardSource } from '../components/MasteryCreateWizard.vue'
import MasteryObjectiveDetail, { type MasteryObjectiveReport } from '../components/MasteryObjectiveDetail.vue'
import LegacyIcon from '../components/LegacyIcon.vue'

interface Point { id: string; name: string; type: string; status: string; mastery: number; deferred?: boolean; prerequisite_ids?: string[]; topic_source_ids?: string[] }
interface Module { id: string; name: string; objective?: string; order: number; mastered: number; total: number; knowledge_points: Point[] }
interface Topic { path_id: string; name: string; updated_at?: number; metadata: { goal?: string; description?: string; emoji?: string; status?: string }; sources?: Source[]; next?: { action?: string; knowledge_point_name?: string; reason?: string; session_id?: string }; path_revision?: number; map: { complete?: boolean; counts: { mastered: number; learning: number; new: number; total: number }; due_reviews: number; modules: Module[] }; session_count: number; reviews?: { due: boolean; knowledge_point_id?: string; knowledge_point_name: string; recent_failure?: boolean }[]; review_settings?: { desired_retention: number }; learner_profile?: Record<string, unknown> | null }
interface Session { session_id: string; title: string; updated_at: number; created_at?: number; status: string; active_turn_id?: string; message_count: number; last_message?: string; pinned?: boolean; has_pending_question?: boolean; archived: boolean }
interface Source { kind: 'knowledge_base' | 'notebook' | 'goal' | string; source_id: string; label: string }
interface ObjectiveReport extends MasteryObjectiveReport {}
interface BoardCard { id: string; name: string; type: string; module_id: string; module_name: string; status: string; mastery_level: number; next_review_at: number | null }
const route = useRoute()
const router = useRouter()
const pathId = computed(() => String(route.params.pathId || ''))
const topics = ref<Topic[]>([])
const topic = ref<Topic | null>(null)
const sessions = ref<Session[]>([])
const boardCards = ref<BoardCard[]>([])
const sourceOptions = ref<WizardSource[]>([])
const selectedSources = ref<Set<string>>(new Set())
const createStep = ref(1)
const createWizard = ref(false)
const goal = ref('')
const emoji = ref('🧭')
const name = ref('')
const retention = ref(0.9)
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const view = ref<'outline' | 'board'>('outline')
const editorOpen = ref(false)
const moreOpen = ref(false)
const confirmAction = ref<'' | 'reset' | 'delete'>('')
const titleEditing = ref(false)
const selectedId = ref<string | null>(null)
const objectiveReport = ref<ObjectiveReport | null>(null)
const reportBusy = ref(false)
const draftModules = ref<Module[]>([])
const sessionsLoading = ref(false)
const sessionsStale = ref(false)
const dueReviews = computed(() => (topic.value?.reviews || []).filter(review => review.due))
const progress = computed(() => { const counts = topic.value?.map.counts; return counts?.total ? Math.round(counts.mastered / counts.total * 100) : 0 })
const sourceLabels = computed(() => (topic.value?.sources || []).filter(source => source.kind !== 'goal').slice(0, 5))
const nextTitle = computed(() => !topic.value?.map.counts.total ? '设计学习大纲' : topic.value?.next?.knowledge_point_name || (dueReviews.value[0]?.knowledge_point_name || '庆祝完成'))
function topicDisplayName(item: Topic) {
  const name = (item.name || '').trim()
  if (name && name !== item.path_id && !/^unified_\d+_[a-z0-9]+$/i.test(name)) return name
  const suffix = item.path_id.split('_').at(-1)?.slice(-4) || 'map'
  return `探索轨迹 · ${suffix}`
}
function topicProgress(item: Topic) {
  const counts = item.map?.counts
  return counts?.total ? Math.max(0, Math.min(1, counts.mastered / counts.total)) : 0
}
function topicProgressPercent(item: Topic) { return Math.round(topicProgress(item) * 100) }
function topicRingOffset(item: Topic) { return 2 * Math.PI * 15.125 * (1 - topicProgress(item)) }
const activeTopics = computed(() => topics.value.filter(item => item.metadata.status === 'active'))
const dueTopics = computed(() => activeTopics.value.filter(item => (item.reviews || []).some(review => review.due)))
const dueTopicCount = computed(() => dueTopics.value.reduce((count, item) => count + (item.reviews || []).filter(review => review.due).length, 0))
const nextReason = computed(() => !topic.value?.map.counts.total ? '这个目标还没有大纲，和导师一起设计第一版。' : topic.value?.next?.reason || (dueReviews.value.length ? '有内容已经到期，现在复习最容易巩固。' : '沿着地图继续下一个知识点。'))
const boardGroups = computed(() => { const groups = new Map<string, BoardCard[]>(); for (const card of boardCards.value) groups.set(card.module_name, [...(groups.get(card.module_name) || []), card]); return [...groups.entries()] })
function cloneModules(modules: Module[]) { return JSON.parse(JSON.stringify(modules)) as Module[] }
async function loadSources() {
  const [kbs, notebooks] = await Promise.all([api<{ name: string }[]>('/api/knowledge-bases/list').catch(() => []), api<{ notebooks: { id: string; name: string }[] }>('/api/notebooks').catch(() => ({ notebooks: [] }))])
  sourceOptions.value = [...kbs.map(kb => ({ kind: 'knowledge_base' as const, source_id: kb.name, label: kb.name })), ...notebooks.notebooks.map(notebook => ({ kind: 'notebook' as const, source_id: notebook.id, label: notebook.name }))]
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    if (pathId.value) {
      const base = `/api/mastery-paths/topics/${encodeURIComponent(pathId.value)}`
      topic.value = await api<Topic>(base)
      name.value = topic.value.name
      retention.value = topic.value.review_settings?.desired_retention ?? 0.9
      draftModules.value = cloneModules(topic.value.map.modules)
      await Promise.all([loadSessions(), loadBoard()])
    } else {
      topics.value = (await api<{ topics: Topic[] }>('/api/mastery-paths/topics')).topics
      topic.value = null
      await loadSources()
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '掌握路径加载失败' }
  finally { loading.value = false }
}
async function loadSessions() {
  if (!pathId.value) return
  sessionsLoading.value = true
  sessionsStale.value = false
  try { sessions.value = (await api<{ sessions: Session[] }>(`/api/mastery-paths/topics/${encodeURIComponent(pathId.value)}/sessions`)).sessions }
  catch { sessionsStale.value = true }
  finally { sessionsLoading.value = false }
}
function formatSessionRelative(timestamp: number) {
  const delta = timestamp - Date.now() / 1000
  const past = delta < 0
  const absolute = Math.abs(delta)
  const [value, unit] = absolute < 60
    ? [Math.round(absolute), 'second']
    : absolute < 3600
      ? [Math.round(absolute / 60), 'minute']
      : absolute < 86400
        ? [Math.round(absolute / 3600), 'hour']
        : absolute < 604800
          ? [Math.round(absolute / 86400), 'day']
          : absolute < 2592000
            ? [Math.round(absolute / 604800), 'week']
            : absolute < 31536000
              ? [Math.round(absolute / 2592000), 'month']
              : [Math.round(absolute / 31536000), 'year']
  return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(past ? -value : value, unit as Intl.RelativeTimeFormatUnit)
}
async function loadBoard() {
  if (!pathId.value) return
  try { const result = await api<{ cards: BoardCard[] }>(`/api/mastery-paths/progress/${encodeURIComponent(pathId.value)}/board`); boardCards.value = result.cards || [] }
  catch { boardCards.value = [] }
}
watch(pathId, load, { immediate: true })
watch(view, loadBoard)
function openCreateWizard() { createStep.value = 1; createWizard.value = true; error.value = '' }
function toggleSource(source: Source) {
  const key = `${source.kind}:${source.source_id}`
  const next = new Set(selectedSources.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedSources.value = next
}
async function create(chosen?: WizardSource[]) {
  if (!goal.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const selected = chosen || sourceOptions.value.filter(source => selectedSources.value.has(`${source.kind}:${source.source_id}`)).map(source => ({ ...source, excerpt: '' }))
    const sources = [{ kind: 'goal', label: '学习目标', excerpt: goal.value.trim() }, ...selected]
    const created = await post<Topic>('/api/mastery-paths/topics', { goal: goal.value.trim(), emoji: emoji.value, sources, modules: [] })
    setMasteryOpeningPrompt('Use the materials I chose and design the outline for this goal with me.')
    await router.push(`/learning/mastery/${encodeURIComponent(created.path_id)}/sessions?mode=outline`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败' }
  finally { busy.value = false }
}
function startTopicReview(item: Topic) {
  const titles = (item.reviews || []).filter(review => review.due).slice(0, 5).map(review => review.knowledge_point_name).filter(Boolean)
  setMasteryOpeningPrompt(titles.length ? `今天一起复习到期内容：${titles.join('、')}。` : '一起复习我已经学过的内容。')
  void router.push(`/learning/mastery/${encodeURIComponent(item.path_id)}/sessions?mode=review`)
}
function startSession(mode: 'outline' | 'study' | 'review') {
  if (mode === 'outline') setMasteryOpeningPrompt('Use the materials I chose and design the outline for this goal with me.')
  if (mode === 'review') {
    const titles = dueReviews.value.slice(0, 5).map(review => review.knowledge_point_name).filter(Boolean)
    setMasteryOpeningPrompt(titles.length ? `今天一起复习到期内容：${titles.join('、')}。` : '一起复习我已经学过的内容。')
  }
  void router.push(`/learning/mastery/${encodeURIComponent(pathId.value)}/sessions?mode=${mode}`)
}
async function rename() {
  if (!topic.value || !name.value.trim()) return
  busy.value = true
  error.value = ''
  try { await api(`/api/mastery-paths/progress/${encodeURIComponent(pathId.value)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.value.trim() }) }); await load(); notice.value = '名称已更新' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '改名失败' }
  finally { busy.value = false }
}
async function saveRetention() {
  busy.value = true
  error.value = ''
  try { topic.value = await api<Topic>(`/api/mastery-paths/topics/${encodeURIComponent(pathId.value)}/review-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ desired_retention: retention.value }) }); notice.value = '复习目标已保存' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
function addModule() { draftModules.value.push({ id: crypto.randomUUID(), name: '新模块', order: draftModules.value.length, mastered: 0, total: 0, knowledge_points: [] }) }
function addPoint(module: Module) { module.knowledge_points.push({ id: crypto.randomUUID(), name: '新知识点', type: 'concept', status: 'new', mastery: 0 }) }
function removePoint(module: Module, point: Point) { if (confirm(`删除知识点“${point.name}”？其掌握记录、复习计划和手动覆盖也会删除。`)) module.knowledge_points = module.knowledge_points.filter(item => item.id !== point.id) }
function moveModule(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= draftModules.value.length) return
  const [module] = draftModules.value.splice(index, 1)
  draftModules.value.splice(target, 0, module)
  draftModules.value.forEach((item, order) => { item.order = order })
}
async function saveMap() {
  if (draftModules.value.some(module => !module.name.trim() || module.knowledge_points.some(point => !point.name.trim()))) { error.value = '模块和知识点名称不能为空'; return }
  busy.value = true
  error.value = ''
  try { topic.value = await api<Topic>(`/api/mastery-paths/topics/${encodeURIComponent(pathId.value)}/map`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modules: draftModules.value }) }); draftModules.value = cloneModules(topic.value.map.modules); editorOpen.value = false; await loadBoard(); notice.value = '路线已保存' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存路线失败' }
  finally { busy.value = false }
}
async function resetProgress() {
  busy.value = true
  try { await post(`/api/mastery-paths/progress/${encodeURIComponent(pathId.value)}/redo`, {}); await load(); notice.value = '学习进度已重置' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '重置进度失败' }
  finally { busy.value = false }
}
async function remove() {
  try { await api(`/api/mastery-paths/progress/${encodeURIComponent(pathId.value)}`, { method: 'DELETE' }); await router.push('/learning/mastery') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
}
async function selectObjective(id: string) { selectedId.value = selectedId.value === id ? null : id; objectiveReport.value = null; if (!selectedId.value) return; reportBusy.value = true; try { const result = await api<{ objective: ObjectiveReport }>(`/api/mastery-paths/progress/${encodeURIComponent(pathId.value)}/objectives/${encodeURIComponent(id)}`); objectiveReport.value = result.objective } catch { objectiveReport.value = null } finally { reportBusy.value = false } }
async function saveTitleInline() { await rename(); titleEditing.value = false }
function startBoardTutoring(card: BoardCard) { setMasteryOpeningPrompt(`Please tutor me on ${card.name}.`); startSession('review') }
async function override(card: BoardCard) {
  try { await post(`/api/mastery-paths/topics/${encodeURIComponent(pathId.value)}/objectives/${encodeURIComponent(card.id)}/override`, { mastered: card.status !== 'mastered', note: '' }); await load(); notice.value = '掌握状态已更新' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '更新掌握状态失败' }
}
</script>

<template>
  <main class="feature-page mastery-page"><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="loading" class="muted" role="status">加载中…</p>
    <template v-if="!pathId"><div class="mastery-index-page"><form class="mastery-compat-create" aria-hidden="true" @submit.prevent="createStep === 1 ? (createStep = 2, createWizard = true) : create()"><textarea v-model="goal" placeholder="描述你的学习目标" tabindex="-1"></textarea><label v-for="source in sourceOptions" v-if="createStep === 2" :key="source.source_id"><input type="checkbox" :checked="selectedSources.has(`${source.kind}:${source.source_id}`)" @change="toggleSource(source)">{{ source.label }}</label></form><header class="mastery-page-bar"><span class="dt-crumb is-feature"><LegacyIcon name="route" :size="15" />精通之路</span><button class="mastery-create" @click="openCreateWizard"><LegacyIcon name="plus" :size="14" />新建精通目标</button></header><section v-if="dueTopicCount" class="mastery-due-banner"><LegacyIcon name="sparkles" :size="18" /><div><strong>{{ dueTopicCount }} 项复习已在 {{ dueTopics.length }} 条路径中到期</strong><p>打开地图做一次短复习，不影响当前学习路线。</p></div><button @click="startTopicReview(dueTopics[0])">开始复习：{{ topicDisplayName(dueTopics[0]) }} →</button></section><section v-if="!loading && !activeTopics.length" class="mastery-empty-map"><span class="mastery-empty-icon">⌾</span><h2>地图仍是一张空白纸</h2><p>告诉 DeepTutor 你想学什么，再加上你的书、笔记和知识库，它会草拟第一版大纲。</p><button class="primary" @click="openCreateWizard"><span>＋</span> 绘制第一张地图</button></section><section v-else class="mastery-topic-list"><div class="partner-grid"><RouterLink v-for="item in activeTopics" :key="item.path_id" :to="`/learning/mastery/${encodeURIComponent(item.path_id)}`" class="mastery-topic-card" :aria-label="`打开 ${topicDisplayName(item)}，已完成 ${item.map?.counts.mastered || 0}/${item.map?.counts.total || 0} 个知识点`"><div class="mastery-topic-main"><span class="mastery-topic-emoji"><LegacyIcon :name="item.map?.complete ? 'check' : 'route'" :size="19" /></span><div class="mastery-topic-copy"><strong>{{ topicDisplayName(item) }}</strong><p v-if="item.metadata?.description || item.metadata?.goal">{{ item.metadata?.description || item.metadata?.goal }}</p></div><div class="mastery-topic-aside"><span class="learning-progress-ring"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15.125" fill="none" stroke="var(--border)" stroke-width="1.75" opacity="0.45" /><circle v-if="topicProgress(item) > 0" cx="16" cy="16" r="15.125" fill="none" :stroke="topicProgress(item) >= 1 ? 'var(--primary)' : 'var(--foreground)'" stroke-width="1.75" stroke-linecap="round" :stroke-dasharray="2 * Math.PI * 15.125" :stroke-dashoffset="topicRingOffset(item)" :opacity="topicProgress(item) >= 1 ? 1 : 0.7" transform="rotate(-90 16 16)" /></svg><span class="learning-progress-label"><b>{{ topicProgressPercent(item) }}</b><small>%</small></span></span><time v-if="Number.isFinite(item.updated_at)" :datetime="new Date((item.updated_at || 0) * 1000).toISOString()" :title="new Date((item.updated_at || 0) * 1000).toLocaleString('zh-CN')">{{ formatSessionRelative(item.updated_at || 0) }}</time></div></div><footer class="mastery-topic-stats"><span>{{ item.map?.modules.length || 0 }} 个模块</span><span>{{ item.map?.counts.mastered || 0 }}/{{ item.map?.counts.total || 0 }} 个知识点</span><span>{{ item.session_count }} 次会话</span></footer></RouterLink></div></section></div><MasteryCreateWizard v-if="createWizard" v-model:goal="goal" v-model:emoji="emoji" :busy="busy" :initial-sources="sourceOptions" :initial-step="createStep" @update:step="createStep = $event" @close="createWizard = false" @create="create" /></template>
    <template v-else-if="topic"><div class="mastery-detail-page"><button class="legacy-sr-only" @click="editorOpen = true">编辑路线</button><button class="legacy-sr-only" @click="resetProgress">重置进度</button><div class="mastery-detail-top"><RouterLink to="/learning/mastery" class="mastery-back-link">← 精通目标</RouterLink><div class="partner-actions"><button class="mastery-quiet-button" @click="editorOpen = true">✎ <span>编辑模块</span></button><details class="mastery-more-menu" :open="moreOpen" @toggle="moreOpen = ($event.target as HTMLDetailsElement).open"><summary class="mastery-quiet-button" @click.prevent="moreOpen = !moreOpen">•••</summary><div class="mastery-more-popover"><button @click="confirmAction = 'reset'; moreOpen = false">↻ 重置进度</button><button class="legacy-danger" @click="confirmAction = 'delete'; moreOpen = false">⌫ 删除路径</button></div></details></div></div><header class="mastery-topic-header"><div class="mastery-topic-title"><form v-if="titleEditing" class="mastery-title-form" @submit.prevent="saveTitleInline"><input v-model="name" maxlength="120" autofocus><button class="primary" :disabled="busy">✓</button><button type="button" @click="titleEditing = false">×</button></form><template v-else><span class="mastery-topic-emoji">{{ topic.metadata.emoji || '🧭' }}</span><h1>{{ topic.name || topic.metadata.goal }}</h1><button class="mastery-title-edit" title="重命名" @click="titleEditing = true">✎</button></template><p>{{ topic.metadata.description || topic.metadata.goal }}</p><div v-if="sourceLabels.length" class="mastery-source-chips"><span v-for="source in sourceLabels" :key="source.source_id">▱ {{ source.label }}</span></div></div><div class="mastery-progress-summary"><span>{{ topic.map.counts.mastered }}/{{ topic.map.counts.total }} 个知识点</span><i></i><div><progress max="100" :value="progress"></progress><strong>{{ progress }}%</strong></div></div></header><section class="mastery-next-up"><div><span>接下来</span><div><strong>{{ nextTitle }}</strong><p>{{ nextReason }}</p></div></div><button v-if="!topic.map.counts.total" class="primary" @click="editorOpen = true">添加模块 →</button><RouterLink v-else class="primary" :to="topic.next?.session_id ? `/learning/mastery/${encodeURIComponent(pathId)}/sessions/${encodeURIComponent(topic.next.session_id)}` : `/learning/mastery/${encodeURIComponent(pathId)}/sessions?mode=${topic.map.due_reviews ? 'review' : 'study'}`" @click="topic.map.due_reviews ? startSession('review') : null">{{ topic.session_count ? '继续学习' : '开始第一个知识点' }} →</RouterLink></section><div class="mastery-detail-grid"><div class="mastery-main-column"><section v-if="!topic.map.counts.total" class="mastery-no-outline"><span>✎</span><h2>还没有学习大纲</h2><p>开启一段对话，导师会阅读你的材料，了解你的基础和时间，再与你一起设计大纲。</p><RouterLink class="primary" :to="`/learning/mastery/${encodeURIComponent(pathId)}/sessions?mode=outline`" @click="startSession('outline')">和导师一起设计大纲 →</RouterLink><button @click="editorOpen = true">✎ 自己编写模块</button></section><template v-else><div class="mastery-view-header"><h2>精通大纲</h2><div class="mastery-view-switch" role="group" aria-label="大纲视图"><button :aria-pressed="view === 'outline'" @click="view = 'outline'">☷ 大纲</button><button :aria-pressed="view === 'board'" @click="view = 'board'">▦ 看板</button></div></div><section v-if="view === 'outline'" class="mastery-outline-panel"><article v-for="(module, moduleIndex) in topic.map.modules" :key="module.id" class="mastery-outline-module"><header><span>{{ String(moduleIndex + 1).padStart(2, '0') }}</span><h3>{{ module.name }}</h3><small>{{ module.mastered }}/{{ module.total }}</small></header><p v-if="module.objective">{{ module.objective }}</p><ul><li v-for="point in module.knowledge_points" :key="point.id"><button class="mastery-objective-row" :aria-expanded="selectedId === point.id" @click="selectObjective(point.id)"><span class="mastery-status-dot" :class="point.status"></span><span>{{ point.name }}</span><small>{{ point.status === 'mastered' ? '已掌握' : point.status === 'learning' ? '学习中' : '未开始' }} · {{ Math.round(point.mastery * 100) }}%</small><i>›</i></button><aside v-if="selectedId === point.id" class="mastery-objective-drawer"><div v-if="reportBusy" class="muted">正在加载学习证据…</div><template v-else-if="objectiveReport"><header><span>{{ objectiveReport.module_name }} · {{ objectiveReport.type }}</span><button @click="selectedId = null">收起</button></header><h4>{{ objectiveReport.name }}</h4><MasteryObjectiveDetail :report="objectiveReport" /><button class="primary" @click="override({ id: point.id, name: point.name, type: point.type, module_id: module.id, module_name: module.name, status: point.status, mastery_level: point.mastery, next_review_at: null })">{{ point.status === 'mastered' ? '恢复评估' : '标记掌握' }}</button></template><p v-else class="muted">暂时无法加载学习证据。</p></aside></li></ul></article></section><section v-else class="mastery-board"><article v-for="[moduleName, cards] in boardGroups" :key="moduleName" class="mastery-board-column"><header><h3>{{ moduleName }}</h3><small>{{ cards.filter(card => card.status === 'mastered').length }}/{{ cards.length }}</small></header><div v-for="card in cards" :key="card.id" class="mastery-board-card"><button @click="selectObjective(card.id)"><span><strong>{{ card.name }}</strong><i class="mastery-status-dot" :class="card.status"></i></span><small>{{ card.type }} <b>{{ Math.round(card.mastery_level * 100) }}%</b></small><em v-if="card.next_review_at">复习 {{ new Date(card.next_review_at * 1000).toLocaleDateString('zh-CN') }}</em></button><aside v-if="selectedId === card.id && objectiveReport" class="mastery-board-detail"><p>{{ objectiveReport.explanation }}</p><button class="primary" @click="startBoardTutoring(card)">开始辅导</button><button @click="override(card)">{{ card.status === 'mastered' ? '恢复评估' : '标记掌握' }}</button></aside></div></article><p v-if="!boardGroups.length" class="muted">暂时无法加载学习看板。</p></section></template><section class="mastery-review-trail"><header><h2>复习计划</h2><button v-if="dueReviews.length" class="primary" @click="startSession('review')">开始复习 →</button></header><p v-if="!dueReviews.length" class="muted">暂无到期复习。导师会根据掌握情况自动安排。</p><button v-for="review in dueReviews" :key="review.knowledge_point_id || review.knowledge_point_name" @click="selectObjective(review.knowledge_point_id || '')"><span class="mastery-status-dot learning"></span>{{ review.knowledge_point_name }}<small>{{ review.recent_failure ? '最近答错，优先复习' : '已到期' }}</small></button><form @submit.prevent="saveRetention"><label>期望保持率 <input v-model.number="retention" type="number" min="0.7" max="0.99" step="0.01"></label><button :disabled="busy">保存</button></form></section></div><aside class="mastery-side-column"><section class="mastery-profile-card"><header>☺ <h2>关于你</h2></header><template v-if="topic.learner_profile"><dl><div v-if="topic.learner_profile.prior_knowledge"><dt>已经了解</dt><dd>{{ topic.learner_profile.prior_knowledge }}</dd></div><div v-if="topic.learner_profile.target_level"><dt>希望达到</dt><dd>{{ topic.learner_profile.target_level }}</dd></div><div v-if="topic.learner_profile.time_budget"><dt>可投入时间</dt><dd>{{ topic.learner_profile.time_budget }}</dd></div><div v-if="topic.learner_profile.preferences"><dt>偏好</dt><dd>{{ topic.learner_profile.preferences }}</dd></div></dl><p>如果这些内容有变化，可以在对话中告诉导师。</p></template><p v-else>导师还没有了解你的情况，会在设计大纲前询问。</p></section><section class="mastery-session-camp"><header><div class="mastery-session-heading"><h2>精通会话</h2><button v-if="sessionsStale" class="mastery-session-retry" @click="loadSessions">无法刷新，点击重试</button></div><RouterLink title="新建学习会话" aria-label="新建学习会话" :to="`/learning/mastery/${encodeURIComponent(pathId)}/sessions`"><LegacyIcon name="plus" :size="14" /></RouterLink></header><div v-if="sessionsLoading" class="mastery-session-loading" role="status"><span class="mastery-spinner" /></div><div v-else-if="!sessions.length" class="mastery-session-empty"><LegacyIcon name="chat" :size="28" /><strong>还没有学习会话</strong><p>开始第一次学习，之后可以回到这里继续，或换个角度重新开始。</p><RouterLink class="primary" :to="`/learning/mastery/${encodeURIComponent(pathId)}/sessions`"><LegacyIcon name="plus" :size="14" />开始学习</RouterLink></div><div v-else class="mastery-session-list"><div v-for="session in sessions" :key="session.session_id" class="mastery-session-row"><RouterLink :to="`/learning/mastery/${encodeURIComponent(pathId)}/sessions/${encodeURIComponent(session.session_id)}`"><span class="mastery-session-icon" :class="{ running: session.status === 'running' || session.active_turn_id }"><LegacyIcon :name="session.status === 'running' || session.active_turn_id ? 'activity' : 'chat'" :size="16" /></span><div><strong>{{ session.title || '未命名会话' }}</strong><small>{{ session.status === 'running' || session.active_turn_id ? '导师正在回答' : `${session.message_count} 条消息 · ${formatSessionRelative(session.updated_at)}` }}</small><p v-if="session.last_message">{{ session.last_message }}</p></div><i>→</i></RouterLink></div><RouterLink class="mastery-fresh-session" :to="`/learning/mastery/${encodeURIComponent(pathId)}/sessions`"><LegacyIcon name="plus" :size="14" />从新的角度开始</RouterLink></div></section></aside></div></div><div v-if="editorOpen" class="mastery-editor-overlay" @click.self="editorOpen = false"><section class="mastery-editor-dialog" role="dialog" aria-modal="true" aria-label="路线工作坊"><header><div><h2>路线工作坊</h2><p>重命名保留学习证据；删除知识点也会删除其掌握记录和复习计划。</p></div><button aria-label="关闭" @click="editorOpen = false">×</button></header><div class="mastery-editor-body"><article v-for="(module, moduleIndex) in draftModules" :key="module.id" class="mastery-module"><div class="partner-actions"><input v-model="module.name" :aria-label="`模块 ${moduleIndex + 1} 名称`"><button @click="moveModule(moduleIndex, -1)">上移</button><button @click="moveModule(moduleIndex, 1)">下移</button><button @click="addPoint(module)">添加知识点</button></div><div v-for="point in module.knowledge_points" :key="point.id" class="mastery-point"><input v-model="point.name" :aria-label="`${module.name} 知识点`"><select v-model="point.type"><option value="concept">概念</option><option value="skill">技能</option><option value="application">应用</option></select><button @click="removePoint(module, point)">删除</button></div></article><button @click="addModule">＋ 添加模块</button></div><footer><button @click="editorOpen = false">取消</button><button class="primary" :disabled="busy" @click="saveMap">保存路线</button></footer></section></div><div v-if="confirmAction" class="mastery-editor-overlay" @click.self="confirmAction = ''"><section class="mastery-confirm-dialog" role="alertdialog" aria-modal="true"><h2>{{ confirmAction === 'reset' ? '重置学习进度？' : '永久删除这条路径？' }}</h2><p>{{ confirmAction === 'reset' ? '路线和学习材料会保留，全部掌握记录和复习进度将重置，此操作无法撤销。' : `“${topic.name}”及其掌握记录、复习计划和学习会话将被删除。` }}</p><footer><button @click="confirmAction = ''">取消</button><button class="primary" @click="confirmAction === 'reset' ? (resetProgress(), confirmAction = '') : (remove(), confirmAction = '')">{{ confirmAction === 'reset' ? '重置进度' : '永久删除' }}</button></footer></section></div></template>
  </main>
</template>
