<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api, post } from '../api'
import MarkdownView from './MarkdownView.vue'

interface HubSkill { slug: string; name: string; summary: string; version: string; downloads: number; stars: number; owner: string; owner_url?: string }
interface HubDetail extends HubSkill { content: string; tags: string[]; web_url?: string }
type InstallState = { kind: 'installing' | 'done' | 'error'; message?: string }
const props = defineProps<{ installedNames?: Set<string> }>()
const emit = defineEmits<{ close: []; installed: [] }>()
const skills = ref<HubSkill[] | null>(null)
const webUrl = ref('https://eduhub.deeptutor.info')
const loading = ref(true)
const error = ref('')
const query = ref('')
const selected = ref<HubSkill | null>(null)
const detail = ref<HubDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const installState = ref<Record<string, InstallState>>({})
const installedLocal = ref(new Set(props.installedNames || []))
let detailVersion = 0
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return (skills.value || []).filter(skill => !needle || `${skill.name} ${skill.slug} ${skill.summary}`.toLowerCase().includes(needle))
})
watch(() => props.installedNames, value => { installedLocal.value = new Set([...installedLocal.value, ...(value || [])]) })
async function loadCatalog() {
  loading.value = true
  error.value = ''
  try {
    const catalog = await api<{ skills: HubSkill[]; web_url?: string }>('/api/skills/hub/catalog?limit=100')
    skills.value = catalog.skills || []
    if (catalog.web_url) webUrl.value = catalog.web_url
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'EduHub 目录加载失败' }
  finally { loading.value = false }
}
async function openDetail(skill: HubSkill) {
  const version = ++detailVersion
  selected.value = skill
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  try {
    const result = await api<HubDetail>(`/api/skills/hub/detail?slug=${encodeURIComponent(skill.slug)}`)
    if (version === detailVersion) detail.value = result
  } catch (cause) { if (version === detailVersion) detailError.value = cause instanceof Error ? cause.message : '技能详情加载失败' }
  finally { if (version === detailVersion) detailLoading.value = false }
}
function closeDetail() { detailVersion++; selected.value = null; detail.value = null; detailError.value = '' }
async function install(skill: HubSkill) {
  const slug = skill.slug
  const force = installedLocal.value.has(slug)
  installState.value[slug] = { kind: 'installing' }
  try {
    const result = await post<{ verdict?: { status?: string } }>('/api/skills/install', { ref: `eduhub:${slug}`, force, allow_unverified: false })
    installState.value[slug] = { kind: 'done', message: result.verdict?.status || 'unknown' }
    installedLocal.value = new Set(installedLocal.value).add(slug)
    emit('installed')
  } catch (cause) { installState.value[slug] = { kind: 'error', message: cause instanceof Error ? cause.message : '下载失败' } }
}
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (selected.value) closeDetail()
  else emit('close')
}
onMounted(() => { void loadCatalog(); window.addEventListener('keydown', onKey) })
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="从 EduHub 导入技能" @click="emit('close')">
    <section class="modal-panel hub-panel" @click.stop>
      <header class="modal-header"><h2>从 EduHub 导入技能</h2><a :href="`${webUrl}/skills`" target="_blank" rel="noopener noreferrer">访问 EduHub ↗</a><button type="button" aria-label="关闭" @click="emit('close')">×</button></header>
      <template v-if="!selected">
        <div class="hub-toolbar"><input v-model="query" type="search" aria-label="搜索 EduHub 技能" placeholder="搜索技能、标识或描述"><button type="button" @click="loadCatalog">刷新</button></div>
        <p v-if="loading" role="status">加载中…</p><p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="loadCatalog">重试</button></p>
        <div class="partner-grid hub-grid"><article v-for="skill in filtered" :key="skill.slug" class="partner-card" tabindex="0" role="button" :aria-label="`查看详情：${skill.name}`" @click="openDetail(skill)" @keydown.enter.prevent="openDetail(skill)" @keydown.space.prevent="openDetail(skill)">
          <strong>{{ skill.name }} <small v-if="installedLocal.has(skill.slug)">已导入</small></strong><p>{{ skill.summary || '暂无描述' }}</p><small>{{ skill.downloads }} 次下载 · {{ skill.stars }} 星<template v-if="skill.owner"> · {{ skill.owner }}</template></small>
          <button type="button" :disabled="installState[skill.slug]?.kind === 'installing'" @click.stop="install(skill)">{{ installState[skill.slug]?.kind === 'installing' ? '下载中…' : installState[skill.slug]?.kind === 'error' ? '重试' : installedLocal.has(skill.slug) ? '重新下载' : '下载' }}</button>
          <p v-if="installState[skill.slug]?.kind === 'done'" class="notice">已导入 · {{ installState[skill.slug].message }}</p><p v-if="installState[skill.slug]?.kind === 'error'" class="error">{{ installState[skill.slug].message }}</p>
        </article></div><p v-if="!loading && !error && !filtered.length" class="muted">没有匹配的 EduHub 技能。</p>
      </template>
      <template v-else>
        <div class="hub-toolbar"><button type="button" @click="closeDetail">← 返回目录</button><a :href="detail?.web_url || `${webUrl}/skills/${selected.slug}`" target="_blank" rel="noopener noreferrer">查看原页面 ↗</a></div>
        <p v-if="detailLoading" role="status">加载中…</p><p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
        <article v-if="detail" class="hub-detail"><header class="feature-heading"><div><h2>{{ detail.name }}</h2><p>{{ detail.summary }}</p></div><button type="button" :disabled="installState[detail.slug]?.kind === 'installing'" @click="install(detail)">{{ installedLocal.has(detail.slug) ? '重新下载' : '下载' }}</button></header><small>{{ detail.version }} · {{ detail.owner }} · {{ detail.tags.join('、') }}</small><p v-if="installState[detail.slug]?.message" :class="installState[detail.slug]?.kind === 'error' ? 'error' : 'notice'">{{ installState[detail.slug]?.kind === 'done' ? '已导入 · ' : '' }}{{ installState[detail.slug].message }}</p><MarkdownView :content="detail.content" strip-frontmatter /></article>
      </template>
    </section>
  </div>
</template>
