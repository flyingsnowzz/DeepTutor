<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import { api } from '../api'

interface QuestionEntry { id: number; question: string; question_type?: string; difficulty?: string; is_correct?: boolean; session_title?: string; material_title?: string; section_title?: string; bookmarked?: boolean; correct_answer?: string; user_answer?: string }
interface Category { id: number; name: string; entry_count: number }
interface Material { source: string; material_id: string; material_title: string; entry_count: number }
type FilterMode = 'all' | 'bookmarked' | 'wrong'
const props = withDefaults(defineProps<{ open: boolean; initial: number[]; everyTurn?: boolean }>(), { everyTurn: false })
const emit = defineEmits<{ close: []; apply: [ids: number[]]; 'update:everyTurn': [value: boolean] }>()
const entries = ref<QuestionEntry[]>([])
const categories = ref<Category[]>([])
const materials = ref<Material[]>([])
const selected = ref<Set<number>>(new Set())
const filter = ref<FilterMode>('all')
const categoryId = ref<number | null>(null)
const materialId = ref('')
const query = ref('')
const loading = ref(false)
const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return entries.value
  return entries.value.filter(entry => `${entry.question} ${entry.session_title || ''} ${entry.material_title || ''} ${entry.section_title || ''}`.toLowerCase().includes(keyword))
})
const allVisibleSelected = computed(() => filtered.value.length > 0 && filtered.value.every(entry => selected.value.has(entry.id)))
async function loadFilters() {
  const [categoryResult, materialResult] = await Promise.allSettled([api<Category[]>('/api/question-notebook/categories'), api<Material[]>('/api/question-notebook/materials')])
  categories.value = categoryResult.status === 'fulfilled' ? categoryResult.value : []
  materials.value = materialResult.status === 'fulfilled' ? materialResult.value : []
}
async function loadEntries() {
  loading.value = true
  const params = new URLSearchParams({ limit: '200', offset: '0' })
  if (filter.value === 'bookmarked') params.set('bookmarked', 'true')
  if (filter.value === 'wrong') params.set('is_correct', 'false')
  if (categoryId.value !== null) params.set('category_id', String(categoryId.value))
  if (materialId.value) params.set('material_id', materialId.value)
  try { entries.value = (await api<{ items: QuestionEntry[] }>(`/api/question-notebook/entries?${params}`)).items || [] }
  catch { entries.value = [] } finally { loading.value = false }
}
function toggle(id: number) { const next = new Set(selected.value); if (next.has(id)) next.delete(id); else next.add(id); selected.value = next }
function toggleVisible() { const next = new Set(selected.value); if (allVisibleSelected.value) filtered.value.forEach(entry => next.delete(entry.id)); else filtered.value.forEach(entry => next.add(entry.id)); selected.value = next }
function clear() { selected.value = new Set() }
function close() { emit('close') }
function apply() { emit('apply', [...selected.value]); close() }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
function resultLabel(entry: QuestionEntry) { return entry.is_correct ? '正确' : entry.user_answer?.trim() ? '答错' : '未作答' }
watch(() => props.open, open => { if (open) { selected.value = new Set(props.initial); filter.value = 'all'; categoryId.value = null; materialId.value = ''; query.value = ''; void loadFilters(); void loadEntries() } })
watch([filter, categoryId, materialId], () => { if (props.open) void loadEntries() })
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template><Teleport to="body"><div v-if="open" class="picker-overlay" @click.self="close"><section class="question-picker" role="dialog" aria-modal="true" aria-labelledby="question-picker-title">
  <header><div class="picker-icon"><LegacyIcon name="questions" :size="18" /></div><div><h2 id="question-picker-title">选择题库题目</h2><p>把题目和作答记录作为本轮回答的参考。</p></div><ResourceReuseToggle :every-turn="everyTurn" @update:every-turn="emit('update:everyTurn', $event)" /><button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="18" /></button></header>
  <div class="question-picker-toolbar"><div class="picker-search"><LegacyIcon name="search" :size="15" /><input v-model="query" type="search" placeholder="搜索题目或来源" /></div><button type="button" @click="toggleVisible">{{ allVisibleSelected ? '取消全选当前结果' : '全选当前结果' }}</button></div>
  <div class="question-picker-body"><aside><h3>筛选</h3><label>状态<select v-model="filter"><option value="all">全部</option><option value="bookmarked">已收藏</option><option value="wrong">仅错题</option></select></label><label>分类<select v-model="categoryId"><option :value="null">全部分类</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}（{{ category.entry_count }}）</option></select></label><label>资料<select v-model="materialId"><option value="">全部资料</option><option v-for="material in materials" :key="`${material.source}-${material.material_id}`" :value="material.material_id">{{ material.material_title }}（{{ material.entry_count }}）</option></select></label></aside>
    <main><div v-if="loading" class="picker-loading"><span class="mastery-spinner" /></div><div v-else-if="!filtered.length" class="picker-empty">没有找到题目</div><template v-else><button v-for="entry in filtered" :key="entry.id" type="button" class="question-entry" :class="{ selected: selected.has(entry.id) }" @click="toggle(entry.id)"><span class="history-check"><LegacyIcon v-if="selected.has(entry.id)" name="check" :size="12" /></span><span><strong>{{ entry.question }}</strong><small><span>{{ resultLabel(entry) }}</span><span v-if="entry.difficulty">{{ entry.difficulty }}</span><span v-if="entry.question_type">{{ entry.question_type }}</span><LegacyIcon v-if="entry.bookmarked" name="bookmark" :size="11" /></small><em v-if="entry.session_title || entry.material_title || entry.section_title">{{ entry.session_title || entry.material_title || entry.section_title }}</em></span></button></template></main>
  </div><footer><span>已选择 {{ selected.size }} 道题</span><div><button type="button" @click="clear">清空</button><button type="button" :disabled="!selected.size" @click="apply">添加到消息</button></div></footer>
</section></div></Teleport></template>
