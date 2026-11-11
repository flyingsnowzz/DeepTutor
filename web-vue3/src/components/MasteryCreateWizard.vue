<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'

export interface WizardSource {
  kind: string
  source_id: string
  label: string
  detail?: string
  excerpt?: string
  parentKey?: string
  metadata?: Record<string, unknown>
}
interface SourceGroup { id: string; label: string; icon: string; sources: WizardSource[] }
const props = withDefaults(defineProps<{ goal: string; emoji: string; busy: boolean; initialSources: WizardSource[]; initialStep?: number }>(), { initialStep: 1 })
const emit = defineEmits<{
  close: []
  'update:goal': [value: string]
  'update:emoji': [value: string]
  create: [sources: WizardSource[]]
  'update:step': [value: number]
}>()
const step = ref(props.initialStep)
watch(step, value => emit('update:step', value))
const tab = ref('knowledgeBases')
const search = ref('')
const selected = ref(new Set<string>())
const expanded = ref(new Set<string>())
const children = ref<Record<string, WizardSource[]>>({})
const loading = ref(true)
const hydrating = ref(false)
const dialog = ref<HTMLElement | null>(null)
const groups = ref<SourceGroup[]>([
  { id: 'knowledgeBases', label: '知识库', icon: 'database', sources: [] },
  { id: 'notebooks', label: '收藏夹', icon: 'bookmark', sources: [] },
  { id: 'books', label: '书籍', icon: 'learning', sources: [] },
  { id: 'questionSets', label: '题库', icon: 'questions', sources: [] },
  { id: 'chats', label: '对话', icon: 'chat', sources: [] },
  { id: 'drafts', label: 'Co-Writer 草稿', icon: 'edit', sources: [] },
  { id: 'partners', label: '伙伴', icon: 'partners', sources: [] },
])
const emblems = [
  { value: '🧭', icon: 'resources', label: '指南针' }, { value: '🏔️', icon: 'activity', label: '山峰' },
  { value: '🌿', icon: 'learning', label: '新芽' }, { value: '🔭', icon: 'search', label: '望远镜' },
  { value: '🧪', icon: 'capability', label: '烧瓶' }, { value: '🧠', icon: 'memory', label: '大脑' },
  { value: '📐', icon: 'edit', label: '尺子' }, { value: '🌌', icon: 'resources', label: '轨道' },
]
const activeGroup = computed(() => groups.value.find(group => group.id === tab.value) || groups.value[0])
const visibleSources = computed(() => activeGroup.value.sources.filter(source => `${source.label} ${source.detail || ''}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const sourceKey = (source: WizardSource) => `${source.kind}:${source.source_id}`
function toggle(source: WizardSource) {
  const key = sourceKey(source)
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else {
    next.add(key)
    for (const values of Object.values(children.value)) for (const child of values) if (child.parentKey === key) next.delete(sourceKey(child))
  }
  selected.value = next
}
async function expand(source: WizardSource) {
  const key = sourceKey(source)
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else {
    next.add(key)
    if (!children.value[key] && source.kind === 'knowledge_base') {
      try {
        const result = await api<{ files: Array<{ name: string; type: string }> }>(`/api/knowledge-bases/${encodeURIComponent(source.source_id)}/files?resource_library=true`)
        children.value[key] = result.files.filter(file => file.type !== 'folder').map(file => ({ kind: 'file', source_id: file.name, label: file.name, detail: `${source.label} 中的文件`, parentKey: key, metadata: { kb_name: source.source_id, path: file.name } }))
      } catch { children.value[key] = [] }
    }
  }
  expanded.value = next
}
function setGroup(id: string) { tab.value = id; search.value = '' }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.busy && !hydrating.value) { event.preventDefault(); emit('close') }
}
async function hydrate(source: WizardSource): Promise<WizardSource> {
  try {
    if (source.kind === 'book') {
      const result = await api<{ spine: { chapters: Array<{ title: string; learning_objectives: string[]; summary: string }> } }>(`/api/books/${encodeURIComponent(source.source_id)}/spine`)
      return { ...source, excerpt: result.spine.chapters.map(chapter => `${chapter.title}: ${[...chapter.learning_objectives, chapter.summary].filter(Boolean).join('; ')}`).join('\n').slice(0, 8000), metadata: { chapter_count: result.spine.chapters.length } }
    }
    if (source.kind === 'notebook') {
      const result = await api<{ records: Array<{ title: string; summary?: string; user_query?: string; output?: string }> }>(`/api/notebooks/${encodeURIComponent(source.source_id)}`)
      return { ...source, excerpt: result.records.slice(0, 16).map(record => `${record.title}\n${record.summary || record.user_query || ''}\n${record.output || ''}`).join('\n\n').slice(0, 8000), metadata: { record_count: result.records.length } }
    }
    return { ...source, excerpt: source.excerpt || source.detail || '' }
  } catch { return { ...source, excerpt: '', metadata: { unavailable_during_generation: true } }
  }
}
async function submit() {
  if (!props.goal.trim() || hydrating.value) return
  hydrating.value = true
  try {
    const chosen = [...groups.value.flatMap(group => group.sources), ...Object.values(children.value).flat()].filter(source => selected.value.has(sourceKey(source)))
    emit('create', await Promise.all(chosen.map(hydrate)))
  } finally { hydrating.value = false }
}
onMounted(async () => {
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', keydown)
  void nextTick(() => dialog.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus())
  groups.value[0].sources = props.initialSources.filter(source => source.kind === 'knowledge_base')
  groups.value[1].sources = props.initialSources.filter(source => source.kind === 'notebook')
  const [books, chats, questions, drafts, partners, partnerGroups] = await Promise.allSettled([
    api<{ books: Array<{ id: string; title: string }> }>('/api/books'),
    api<{ sessions: Array<{ id: string; title: string; last_message?: string }> }>('/api/sessions?limit=200'),
    api<{ items: Array<{ id: string | number; question: string }> }>('/api/question-notebook/entries?per_page=100'),
    api<{ documents: Array<{ id: string; title: string; preview?: string }> }>('/api/documents'),
    api<Array<{ partner_id: string; name: string }>>('/api/partners'),
    api<Array<{ group_id: string; name: string }>>('/api/partner-groups'),
  ])
  if (books.status === 'fulfilled' && Array.isArray(books.value.books)) groups.value[2].sources = books.value.books.map(book => ({ kind: 'book', source_id: book.id, label: book.title, detail: 'AI 编写书籍' }))
  if (questions.status === 'fulfilled' && Array.isArray(questions.value.items)) groups.value[3].sources = questions.value.items.map(item => ({ kind: 'question_bank', source_id: String(item.id), label: item.question, detail: item.question, excerpt: item.question }))
  if (chats.status === 'fulfilled' && Array.isArray(chats.value.sessions)) groups.value[4].sources = chats.value.sessions.map(session => ({ kind: 'chat', source_id: session.id, label: session.title || '新对话', detail: session.last_message || '', excerpt: session.last_message || '' }))
  if (drafts.status === 'fulfilled' && Array.isArray(drafts.value.documents)) groups.value[5].sources = drafts.value.documents.map(document => ({ kind: 'cowriter', source_id: document.id, label: document.title || '未命名页面', detail: document.preview || '', excerpt: document.preview || '' }))
  if (partners.status === 'fulfilled' || partnerGroups.status === 'fulfilled') {
    const partnerSources = partners.status === 'fulfilled' && Array.isArray(partners.value) ? partners.value.map(partner => ({ kind: 'partner', source_id: partner.partner_id, label: partner.name, detail: '伙伴' })) : []
    const groupSources = partnerGroups.status === 'fulfilled' && Array.isArray(partnerGroups.value) ? partnerGroups.value.map(group => ({ kind: 'partner_group', source_id: group.group_id, label: group.name, detail: '伙伴群组' })) : []
    groups.value[6].sources = [...partnerSources, ...groupSources]
  } else groups.value = groups.value.filter(group => group.id !== 'partners')
  loading.value = false
})
onBeforeUnmount(() => { document.body.style.overflow = ''; document.removeEventListener('keydown', keydown) })
</script>

<template>
  <Teleport to="body"><div class="mastery-create-overlay mastery-wizard-overlay" @mousedown.self="!busy && !hydrating && emit('close')"><section ref="dialog" class="mastery-create-dialog mastery-wizard-dialog" role="dialog" aria-modal="true" aria-labelledby="mastery-wizard-title" tabindex="-1">
    <header class="mastery-wizard-header"><div><span class="mastery-wizard-kicker"><LegacyIcon name="sparkles" :size="13" />新建精通目标</span><h2 id="mastery-wizard-title">{{ step === 1 ? '你想精通什么？' : '选择资料' }}</h2></div><button aria-label="关闭" :disabled="busy || hydrating" @click="emit('close')"><LegacyIcon name="close" :size="16" /></button></header>
    <ol class="mastery-wizard-steps" aria-label="创建步骤"><li v-for="(label, index) in ['目标', '资料']" :key="label" :class="{ 'is-current': step === index + 1, 'is-done': step > index + 1 }"><span>{{ step > index + 1 ? '✓' : index + 1 }}</span>{{ label }}</li></ol>
    <div class="mastery-wizard-body">
      <div v-if="step === 1" class="mastery-wizard-goal"><h3>你想精通什么？</h3><p>说清楚你想具备什么能力。导师会读你的资料，在第一次会话里和你一起把大纲定下来——那时候还能改。</p><label>学习目标<textarea :value="goal" rows="5" maxlength="2000" placeholder="我希望能从几何直觉出发，理解向量空间、线性变换，并能独立解决特征值问题。" @input="emit('update:goal', ($event.target as HTMLTextAreaElement).value)" /></label><fieldset><legend>目标徽记</legend><div class="mastery-wizard-emblems"><button v-for="item in emblems" :key="item.value" type="button" :aria-label="`选择目标徽记 ${item.label}`" :aria-pressed="emoji === item.value" @click="emit('update:emoji', item.value)"><LegacyIcon :name="item.icon" :size="18" /></button></div></fieldset></div>
      <div v-else class="mastery-wizard-sources"><div class="mastery-wizard-source-heading"><h3>知识来源</h3><span>已选择 {{ selected.size }} 项</span></div><input v-model="search" type="search" aria-label="搜索资料" placeholder="搜索资料"><div class="mastery-wizard-tabs" role="tablist" aria-label="知识来源"><button v-for="group in groups" :key="group.id" role="tab" :aria-selected="tab === group.id" @click="setGroup(group.id)"><LegacyIcon :name="group.icon" :size="14" />{{ group.label }}<span>{{ group.sources.length }}</span></button></div><p v-if="loading" class="muted">正在载入学习材料…</p><div v-else class="mastery-wizard-source-list"><article v-for="source in visibleSources" :key="sourceKey(source)" class="mastery-wizard-source" :class="{ 'is-selected': selected.has(sourceKey(source)) }"><div class="mastery-wizard-source-row"><button class="mastery-wizard-source-main" :aria-label="`${source.label}${activeGroup.label}`" @click="toggle(source)"><span class="mastery-wizard-check"><LegacyIcon v-if="selected.has(sourceKey(source))" name="check" :size="12" /></span><span><strong>{{ source.label }}</strong><small v-if="source.detail">{{ source.detail }}</small></span></button><button v-if="source.kind === 'knowledge_base'" class="mastery-wizard-expand" :aria-label="`展开 ${source.label}`" :aria-expanded="expanded.has(sourceKey(source))" @click="expand(source)"><LegacyIcon name="document" :size="13" /><LegacyIcon name="chevronDown" :size="12" /></button></div><div v-if="expanded.has(sourceKey(source))" class="mastery-wizard-children"><button v-for="child in children[sourceKey(source)] || []" :key="sourceKey(child)" :disabled="selected.has(sourceKey(source))" @click="toggle(child)"><span class="mastery-wizard-check"><LegacyIcon v-if="selected.has(sourceKey(child))" name="check" :size="12" /></span><span><strong>{{ child.label }}</strong><small>{{ selected.has(sourceKey(source)) ? '已包含在整个知识库中' : child.detail }}</small></span></button><p v-if="!(children[sourceKey(source)] || []).length">没有可选择的文件。</p></div></article><p v-if="!visibleSources.length" class="mastery-wizard-no-sources">这里暂时没有可选择的材料。</p></div></div>
    </div>
    <footer class="mastery-wizard-footer"><button v-if="step === 2" class="mastery-wizard-back" :disabled="busy || hydrating" @click="step = 1"><LegacyIcon name="arrowLeft" :size="14" />上一步</button><span v-else /><div><button v-if="step === 1" class="primary" :disabled="!goal.trim()" @click="step = 2">选择资料<LegacyIcon name="chevronRight" :size="14" /></button><button v-else class="primary" :disabled="busy || hydrating" @click="submit">{{ hydrating ? '正在读取材料…' : busy ? '正在创建…' : '和导师一起定大纲' }}<LegacyIcon name="sparkles" :size="14" /></button></div></footer>
  </section></div></Teleport>
</template>
