<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import RuntimeHealthStrip from './RuntimeHealthStrip.vue'
import ProviderIcon from './ProviderIcon.vue'
import { statusTranslations } from './statusTranslations'
import { statusTranslationsEn } from './statusTranslationsEn'
import { currentDiagnosticsResult, readDiagnosticsResults } from '../settingsDiagnostics'
const props = defineProps<{ enabled: boolean; draftState: 'clean' | 'saved' | 'unsaved'; language?: string }>()
import {
  groupReadinessRows,
  isProminentReadinessRow,
  readinessRowHref,
  readinessRowSeverity,
} from '../settingsReadiness'
type State = 'enabled_verified' | 'available_disabled' | 'unavailable' | 'misconfigured' | 'not_selected'
interface Row { id: string; section: string; label: string; state: State; detail_code: string; enabled: boolean; available: boolean; configured: boolean; verified: boolean; required: boolean }
interface Snapshot { ok: boolean; summary: Record<State, number>; rows: Row[]; notices: { code: string; row_id: string; section: string; severity: string }[] }
interface Module { id: string; installed: boolean; enabled: boolean; ready: boolean; issues: string[] }
interface MemoryProcess { label: string; count: number; rss_bytes: number }
interface Memory { available: boolean; total_rss_bytes?: number; limit_bytes?: number | null; available_bytes?: number | null; limit_source?: string; usage_ratio?: number | null; partial?: boolean; processes?: MemoryProcess[] }
const snapshot = ref<Snapshot | null>(null)
const modules = ref<Module[] | null>(null)
const modulesError = ref(false)
const modulesLoading = ref(false)
const catalog = ref<Record<string, any> | null>(null)
const diagnosticsResults = ref(readDiagnosticsResults())
const backend = ref('checking')
const memory = ref<Memory | null>(null)
const loading = ref(true)
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let mounted = false
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const t = (key: string) => (chinese.value ? statusTranslations : statusTranslationsEn)[key] ?? key
const countText = (key: string, n: number) => t(key).replace('{{n}}', String(n))
const stateText = (state: State) => t(`readiness.state.${state}`)
const sectionText = (section: string) => t(`readiness.section.${section}`)
const detailText = (code: string) => t(`readiness.detail.${code}`) === `readiness.detail.${code}` ? '' : t(`readiness.detail.${code}`)
const summary = computed(() => snapshot.value ? [
  countText('readiness.summary.ready', snapshot.value.summary.enabled_verified),
  snapshot.value.summary.available_disabled && countText('readiness.summary.available', snapshot.value.summary.available_disabled),
  snapshot.value.summary.unavailable + snapshot.value.summary.not_selected && countText('readiness.summary.idle', snapshot.value.summary.unavailable + snapshot.value.summary.not_selected),
].filter(Boolean).join(' · ') : t('readiness.blurb'))
const rows = computed(() => (snapshot.value?.rows ?? []).map(row => {
  if (!row.id.startsWith('catalog.')) return row
  const service = row.id.slice('catalog.'.length)
  if (currentDiagnosticsResult(catalog.value, service, diagnosticsResults.value)?.state !== 'failed') return row
  return { ...row, state: 'misconfigured' as const, detail_code: 'connection_test_failed' }
}))
const attention = computed(() => {
  const currentRows = rows.value
  const items = currentRows.filter(row => readinessRowSeverity(row) !== null).map(row => ({
    id: row.id, label: t(row.label), detail: detailText(row.detail_code), href: href(row),
    severity: readinessRowSeverity(row),
  }))
  items.sort((left, right) => left.severity === right.severity ? 0 : left.severity === 'blocker' ? -1 : 1)
  if (props.draftState !== 'clean') items.push({
    id: 'draft', label: t('readiness.attention.draft'),
    detail: t(props.draftState === 'saved' ? 'readiness.attention.draftSaved' : 'readiness.attention.draftUnsaved'),
    href: '/settings/llm', severity: 'warning',
  })
  for (const notice of snapshot.value?.notices ?? []) {
    if (notice.severity !== 'suggestion') continue
    const row = currentRows.find(item => item.id === notice.row_id)
    items.push({
      id: `${notice.code}:${notice.row_id}`,
      label: row ? t(row.label) : sectionText(notice.section),
      detail: detailText(notice.code), href: row ? href(row) : null, severity: 'suggestion',
    })
  }
  return items
})
const groups = computed(() => groupReadinessRows(rows.value))
function prominent(row: Row) { return isProminentReadinessRow(row) }
function folded(section: string) { return groups.value.find(group => group.section === section)?.rows.filter(row => !prominent(row)) ?? [] }
function href(row: Row) { return readinessRowHref(row.id) }
function profile(row: Row) {
  if (!catalog.value || !row.id.startsWith('catalog.')) return null
  const config = catalog.value.services?.[row.id.slice(8)]
  return config?.profiles?.find((item: { id: string }) => item.id === config.active_profile_id) ?? config?.profiles?.[0] ?? null
}
function model(row: Row) {
  const selected = profile(row)
  if (row.id === 'catalog.search') return selected?.provider || ''
  const config = catalog.value?.services?.[row.id.slice(8)]
  return selected?.models?.find((item: { id: string }) => item.id === config?.active_model_id)?.model || selected?.models?.[0]?.model || ''
}
function provider(row: Row) {
  const selected = profile(row)
  return row.id === 'catalog.search' ? selected?.provider || '' : selected?.binding || ''
}
function formatBytes(bytes?: number | null) { if (bytes == null) return '—'; return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB` }
const memorySummary = computed(() => {
  const value = memory.value
  if (!value) return '—'
  if (value.usage_ratio == null || !value.limit_bytes) return formatBytes(value.total_rss_bytes)
  return `${formatBytes(value.total_rss_bytes)} · ${Math.max(Math.round(value.usage_ratio * 100), 1)}% ${tr('/', 'of')} ${formatBytes(value.limit_bytes)}`
})
function processLabel(label: string) { return ({ backend: tr('后端', 'Backend'), web: tr('前端', 'Frontend'), sandbox: tr('沙箱', 'Sandbox'), supervisor: tr('管理进程', 'Supervisor'), other: tr('其他', 'Other') } as Record<string, string>)[label] || label }
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [ready, settings] = await Promise.all([
      api<Snapshot>('/api/settings/readiness'),
      api<Record<string, any>>('/api/settings').catch(() => null),
    ])
    if (!mounted) return
    snapshot.value = ready
    catalog.value = settings?.catalog || null
  } catch {
    if (mounted) error.value = t('readiness.error')
  } finally {
    if (mounted) loading.value = false
  }
}
async function loadModules() {
  modulesLoading.value = true
  modulesError.value = false
  try {
    const result = await api<{ modules: Module[] }>('/api/modules')
    if (mounted) modules.value = result.modules
  } catch {
    if (mounted) modulesError.value = true
  } finally {
    if (mounted) modulesLoading.value = false
  }
}
async function loadBackend() {
  try {
    const result = await api<{ backend: { status: string } }>('/api/system/status')
    if (mounted) backend.value = result.backend?.status || 'checking'
  } catch {
    if (mounted) backend.value = 'checking'
  }
}
async function loadMemory() { try { const result = await api<Memory>('/api/system/memory'); if (mounted) memory.value = result } catch { /* Keep the last reading. */ } finally { if (mounted && !document.hidden) timer = setTimeout(loadMemory, 10000) } }
function visibilityChanged() { if (timer) clearTimeout(timer); timer = undefined; if (!document.hidden) void loadMemory() }
onMounted(() => { mounted = true; void load(); void loadModules(); void loadBackend(); void loadMemory(); document.addEventListener('visibilitychange', visibilityChanged) })
onUnmounted(() => { mounted = false; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', visibilityChanged) })
</script>
<template><div><header class="legacy-settings-page-header"><h1>{{ tr('运行状态', 'Runtime status') }}</h1><p>{{ tr('检查已配置的服务并解决连接问题。', 'Check configured services and resolve connection problems.') }}</p></header><section class="status-modules"><header><h2>{{ tr('模块', 'Modules') }}</h2><p>{{ tr('更改模块前请先停止 DeepTutor，移除模块会保留数据。', 'Stop DeepTutor before changing modules. Removing a module keeps your data.') }}</p></header><button v-if="modulesError" type="button" @click="loadModules">{{ tr('重试', 'Retry') }}</button><p v-if="modulesLoading && !modules" aria-busy="true">{{ tr('加载中…', 'Loading...') }}</p><div class="status-module-table"><table><thead><tr><th>{{ tr('模块', 'Module') }}</th><th>{{ tr('已安装', 'Installed') }}</th><th>{{ tr('已启用', 'Enabled') }}</th><th>{{ tr('已就绪', 'Ready') }}</th><th>{{ tr('命令', 'Command') }}</th></tr></thead><tbody><tr v-for="module in modules || []" :key="module.id"><td><code>{{ module.id }}</code><p v-for="issue in module.issues" :key="issue">{{ issue }}</p></td><td>{{ module.installed ? tr('是', 'Yes') : tr('否', 'No') }}</td><td>{{ module.enabled ? tr('是', 'Yes') : tr('否', 'No') }}</td><td>{{ module.ready ? tr('是', 'Yes') : tr('否', 'No') }}</td><td><code>{{ module.id === 'core' ? '—' : `deeptutor module ${!module.installed ? 'install' : !module.enabled ? 'enable' : 'disable'} ${module.id}` }}</code></td></tr></tbody></table></div></section><section class="status-strip"><div><i :class="{ online: backend === 'online' }" /><strong>{{ tr('后端', 'Backend') }}</strong><span>{{ backend === 'online' ? tr('在线', 'Online') : tr('检查中', 'Checking') }}</span></div><RuntimeHealthStrip :language="language" /><template v-if="memory?.available"><div><i :class="(memory.usage_ratio || 0) >= .9 ? 'danger' : (memory.usage_ratio || 0) >= .7 ? 'warn' : 'online'" /><strong>{{ tr('系统内存', 'System memory') }}</strong><span>{{ memorySummary }}</span></div><div class="status-memory-processes"><span v-for="process in memory.processes || []" :key="process.label">{{ processLabel(process.label) }}{{ process.count > 1 ? ` ×${process.count}` : '' }} <strong>{{ formatBytes(process.rss_bytes) }}</strong></span><span>{{ memory.limit_source === 'cgroup' ? tr('容器可用', 'Container available') : tr('系统可用', 'System available') }} <strong>{{ formatBytes(memory.available_bytes) }}</strong></span></div></template></section><section class="status-readiness"><header><div><h2>{{ t('readiness.title') }}</h2><p>{{ summary }}</p></div><button :disabled="loading || !enabled" @click="load"><LegacyIcon name="history" :size="13" />{{ t('readiness.refresh') }}</button></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="loading && !snapshot" class="legacy-settings-loading">{{ t('readiness.loading') }}</p><template v-else-if="snapshot"><section class="status-attention"><h3>{{ t('readiness.attention.title') }}</h3><p v-if="!attention.length">{{ t('readiness.attention.none') }}</p><template v-for="item in attention" :key="item.id"><RouterLink v-if="enabled && item.href" :to="item.href"><span>{{ item.label }}<small v-if="item.detail">{{ item.detail }}</small></span><strong>{{ t('readiness.attention.open') }} ↗</strong></RouterLink><div v-else class="status-attention-row"><span>{{ item.label }}<small v-if="item.detail">{{ item.detail }}</small></span></div></template></section><div class="status-groups"><section v-for="group in groups" :key="group.section"><header><h3>{{ sectionText(group.section) }}</h3><span v-if="group.rows.filter(row => row.state === 'enabled_verified').length">{{ countText('readiness.group.ready', group.rows.filter(row => row.state === 'enabled_verified').length) }}</span></header><ul><li v-for="row in group.rows.filter(prominent)" :key="row.id"><span><RouterLink v-if="href(row)" :to="href(row)!">{{ t(row.label) }}</RouterLink><strong v-else>{{ t(row.label) }}</strong><small v-if="row.state !== 'enabled_verified'">{{ detailText(row.detail_code) }}</small></span><span><span v-if="model(row)" class="status-row-model"><ProviderIcon v-if="provider(row)" :provider="provider(row)" :size="12" /><code>{{ model(row) }}</code></span><em :class="row.state">{{ stateText(row.state) }}</em></span></li></ul><details v-if="folded(group.section).length"><summary>{{ countText('readiness.group.folded', folded(group.section).length) }}</summary><ul><li v-for="row in folded(group.section)" :key="row.id"><span><RouterLink v-if="href(row)" :to="href(row)!">{{ t(row.label) }}</RouterLink><strong v-else>{{ t(row.label) }}</strong><small>{{ detailText(row.detail_code) }}</small></span><span><span v-if="model(row)" class="status-row-model"><ProviderIcon v-if="provider(row)" :provider="provider(row)" :size="12" /><code>{{ model(row) }}</code></span><em :class="row.state">{{ stateText(row.state) }}</em></span></li></ul></details></section></div></template></section></div></template>
