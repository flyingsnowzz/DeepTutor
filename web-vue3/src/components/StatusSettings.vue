<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import { statusTranslations } from './statusTranslations'
import { noticeSeverityLabel, noticeTone, sortNotices } from '../readinessNotices'
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
interface Memory { available: boolean; total_rss_bytes?: number; available_bytes?: number | null; limit_source?: string; usage_ratio?: number | null; partial?: boolean; processes?: MemoryProcess[] }
const snapshot = ref<Snapshot | null>(null)
const modules = ref<Module[] | null>(null)
const catalog = ref<Record<string, any> | null>(null)
const backend = ref('checking')
const memory = ref<Memory | null>(null)
const loading = ref(true)
const error = ref('')
let timer: ReturnType<typeof setInterval> | undefined
const t = (key: string) => statusTranslations[key] ?? key
const stateText = (state: State) => t(`readiness.state.${state}`)
const sectionText = (section: string) => t(`readiness.section.${section}`)
const detailText = (code: string) => t(`readiness.detail.${code}`) === `readiness.detail.${code}` ? '' : t(`readiness.detail.${code}`)
const summary = computed(() => snapshot.value ? `${snapshot.value.summary.enabled_verified} 项就绪${snapshot.value.summary.available_disabled ? ` · ${snapshot.value.summary.available_disabled} 项可开启` : ''}${snapshot.value.summary.unavailable + snapshot.value.summary.not_selected ? ` · ${snapshot.value.summary.unavailable + snapshot.value.summary.not_selected} 项未配置` : ''}` : '当前设置下，哪些能力可以真正跑起来。')
const attention = computed(() => (snapshot.value?.rows ?? []).filter(row => readinessRowSeverity(row) !== null))
const notices = computed(() => sortNotices(snapshot.value?.notices ?? []))
const groups = computed(() => groupReadinessRows(snapshot.value?.rows ?? []))
function prominent(row: Row) { return isProminentReadinessRow(row) }
function folded(section: string) { return groups.value.find(group => group.section === section)?.rows.filter(row => !prominent(row)) ?? [] }
function href(row: Row) { return readinessRowHref(row.id) }
function model(row: Row) { if (!catalog.value || !row.id.startsWith('catalog.')) return ''; const config = catalog.value.services?.[row.id.slice(8)]; const profile = config?.profiles?.find((item: { id: string }) => item.id === config.active_profile_id) ?? config?.profiles?.[0]; if (row.id === 'catalog.search') return profile?.provider || ''; return profile?.models?.find((item: { id: string }) => item.id === config.active_model_id)?.model || profile?.models?.[0]?.model || '' }
function formatBytes(bytes?: number | null) { if (bytes == null) return '—'; return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB` }
async function load() { loading.value = true; error.value = ''; try { const [ready, moduleResult, settings, system] = await Promise.all([api<Snapshot>('/api/settings/readiness'), api<{ modules: Module[] }>('/api/modules'), api<Record<string, any>>('/api/settings').catch(() => null), api<{ backend: { status: string } }>('/api/system/status').catch(() => null)]); snapshot.value = ready; modules.value = moduleResult.modules; catalog.value = settings?.catalog || null; backend.value = system?.backend.status || 'online' } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取可用状态' } finally { loading.value = false } }
async function loadMemory() { try { memory.value = await api<Memory>('/api/system/memory') } catch { /* Keep the last reading. */ } }
load(); void loadMemory(); timer = setInterval(loadMemory, 10000); onUnmounted(() => { if (timer) clearInterval(timer) })
</script>
<template><div><header class="legacy-settings-page-header"><h1>运行状态</h1><p>检查已配置的服务并解决连接问题。</p></header><section class="status-modules"><header><h2>模块</h2><p>更改模块前请先停止 DeepTutor，移除模块会保留数据。</p></header><div class="status-module-table"><table><thead><tr><th>模块</th><th>已安装</th><th>已启用</th><th>已就绪</th><th>命令</th></tr></thead><tbody><tr v-for="module in modules || []" :key="module.id"><td><code>{{ module.id }}</code><p v-for="issue in module.issues" :key="issue">{{ issue }}</p></td><td>{{ module.installed ? '是' : '否' }}</td><td>{{ module.enabled ? '是' : '否' }}</td><td>{{ module.ready ? '是' : '否' }}</td><td><code>{{ module.id === 'core' ? '—' : `deeptutor module ${!module.installed ? 'install' : !module.enabled ? 'enable' : 'disable'} ${module.id}` }}</code></td></tr></tbody></table></div></section><section class="status-strip"><div><i :class="{ online: backend === 'online' }" /><strong>后端</strong><span>{{ backend === 'online' ? '在线' : '检查中' }}</span></div><template v-if="memory?.available"><div><i :class="(memory.usage_ratio || 0) >= .9 ? 'danger' : (memory.usage_ratio || 0) >= .7 ? 'warn' : 'online'" /><strong>系统内存</strong><span>{{ formatBytes(memory.total_rss_bytes) }}</span></div><div class="status-memory-processes"><span v-for="process in memory.processes || []" :key="process.label">{{ process.label }}{{ process.count > 1 ? ` ×${process.count}` : '' }} <strong>{{ formatBytes(process.rss_bytes) }}</strong></span><span>可用 <strong>{{ formatBytes(memory.available_bytes) }}</strong></span></div></template></section><section class="status-readiness"><header><div><h2>运行就绪</h2><p>{{ summary }}</p></div><button :disabled="loading" @click="load"><LegacyIcon name="history" :size="13" />刷新</button></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="loading && !snapshot" class="legacy-settings-loading">正在检查可用状态…</p><template v-else-if="snapshot"><section class="status-attention"><h3>需要处理</h3><p v-if="!attention.length">没有需要处理的项。</p><RouterLink v-for="row in attention" :key="row.id" :to="href(row) || '/settings/status'"><span>{{ t(row.label) }}<small>{{ detailText(row.detail_code) }}</small></span><strong>打开 ↗</strong></RouterLink></section><section v-if="notices.length" class="status-notices">
      <h3>系统通知</h3>
      <ul>
        <li v-for="notice in notices" :key="`${notice.row_id}-${notice.code}`" :class="`notice-${noticeTone(notice.severity)}`">
          <em class="notice-severity">{{ noticeSeverityLabel(notice.severity) }}</em>
          <span>
            <strong>{{ t(notice.row_id) === notice.row_id ? notice.code : t(notice.row_id) }}</strong>
            <small v-if="detailText(notice.code)">{{ detailText(notice.code) }}</small>
            <code v-if="t(notice.row_id) === notice.row_id">{{ notice.code }}</code>
          </span>
          <RouterLink v-if="href({ id: notice.row_id } as Row)" :to="href({ id: notice.row_id } as Row) || '/settings/status'">打开 ↗</RouterLink>
        </li>
      </ul>
    </section>
    <div class="status-groups"><section v-for="group in groups" :key="group.section"><header><h3>{{ sectionText(group.section) }}</h3><span v-if="group.rows.filter(row => row.state === 'enabled_verified').length">{{ group.rows.filter(row => row.state === 'enabled_verified').length }} 项就绪</span></header><ul><li v-for="row in group.rows.filter(prominent)" :key="row.id"><span><RouterLink v-if="href(row)" :to="href(row)!">{{ t(row.label) }}</RouterLink><strong v-else>{{ t(row.label) }}</strong><small v-if="row.state !== 'enabled_verified'">{{ detailText(row.detail_code) }}</small></span><span><code v-if="model(row)">{{ model(row) }}</code><em :class="row.state">{{ stateText(row.state) }}</em></span></li></ul><details v-if="folded(group.section).length"><summary>另有 {{ folded(group.section).length }} 项未启用</summary><ul><li v-for="row in folded(group.section)" :key="row.id"><span><RouterLink v-if="href(row)" :to="href(row)!">{{ t(row.label) }}</RouterLink><strong v-else>{{ t(row.label) }}</strong><small>{{ detailText(row.detail_code) }}</small></span><span><code v-if="model(row)">{{ model(row) }}</code><em :class="row.state">{{ stateText(row.state) }}</em></span></li></ul></details></section></div></template></section></div></template>
