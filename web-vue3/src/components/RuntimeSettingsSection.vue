<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, post } from '../api'
import EngineConfigForm from './EngineConfigForm.vue'
import ChatHistoryPage from '../views/ChatHistoryPage.vue'
import UsageSettings from './UsageSettings.vue'
import AboutSettings from './AboutSettings.vue'
import VideoLearningSettings from './VideoLearningSettings.vue'
import DocumentParsingSettings from './DocumentParsingSettings.vue'
import MinerUSettings from './MinerUSettings.vue'
import MemorySettings from './MemorySettings.vue'
import CapabilitiesSettings from './CapabilitiesSettings.vue'
import WorkspaceSettings from './WorkspaceSettings.vue'
import DataMigrationSettings from './DataMigrationSettings.vue'

const props = withDefaults(defineProps<{ section: string; pending?: unknown; mineruPending?: unknown; revision?: number }>(), { revision: 0 })
const emit = defineEmits<{ change: [value: Record<string, any>]; loaded: [value: Record<string, any>]; mineruChange: [value: Record<string, any>]; mineruLoaded: [value: Record<string, any>] }>()
const parsingEngine = ref('')
const data = ref<Record<string, any>>({})
const error = ref('')
const notice = ref('')
const busy = ref(false)
const usage = ref<any>(null)
const year = ref(new Date().getFullYear())
const workspaces = ref<any[]>([])
const workspaceDraft = ref({ display_name: '', path: '', instructions: '' })
const migration = ref<{ features: { feature: string; label?: string; files: number; bytes: number }[]; transfer_available: boolean } | null>(null)
const migrationSource = ref('')
const migrationTarget = ref('')
const migrationFeatures = ref<Set<string>>(new Set())
const migrationPreview = ref<any>(null)
const operations = ref<any[]>([])
const update = ref<any>(null)
const endpoints: Record<string, string> = { capabilities: '/api/capabilities/settings', memory: '/api/memory/settings', knowledge: '/api/settings/document-parsing', 'video-learning': '/api/settings/video-learning' }
async function load() {
  error.value = ''
  try {
    if (endpoints[props.section]) {
      const live = await api<Record<string, any>>(endpoints[props.section])
      data.value = (props.pending as Record<string, any> | undefined) ?? live
      emit('loaded', live)
    }
    else if (props.section === 'usage') usage.value = await api(`/api/usage?year=${year.value}`)
    else if (props.section === 'workspace') workspaces.value = (await api<{ workspaces: any[] }>('/api/settings/workspace/registrations')).workspaces
    else if (props.section === 'data-migration') { workspaces.value = (await api<{ workspaces: any[] }>('/api/settings/workspace/registrations')).workspaces; migrationSource.value = workspaces.value[0]?.workspace_id || ''; await Promise.all([loadMigrationDiscovery(), loadOperations()]) }
    else if (props.section === 'about') update.value = await api('/api/system/update')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '设置加载失败' }
}
onMounted(load)
watch(() => props.revision, load)
function changed() { if (endpoints[props.section]) emit('change', data.value) }
async function save() {
  busy.value = true
  error.value = ''
  try { data.value = await api(endpoints[props.section], { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data.value) }); notice.value = '设置已保存' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
async function saveWorkspace(workspace: any) {
  try { await api(`/api/settings/workspace/registrations/${encodeURIComponent(workspace.workspace_id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: workspace.display_name, instructions: workspace.instructions, archived: workspace.archived }) }); notice.value = '工作区已保存'; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存工作区失败' }
}
async function createWorkspace() {
  if (!workspaceDraft.value.path.trim()) return
  try { await post('/api/settings/workspace/registrations', { name: workspaceDraft.value.display_name, path: workspaceDraft.value.path || undefined, instructions: workspaceDraft.value.instructions || undefined }); workspaceDraft.value = { display_name: '', path: '', instructions: '' }; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '创建工作区失败' }
}
async function loadMigrationDiscovery() {
  if (!migrationSource.value) return
  try { migration.value = await api(`/api/settings/workspace/data/discover?source_workspace_id=${encodeURIComponent(migrationSource.value)}`) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '数据发现失败' }
}
async function loadOperations() { try { operations.value = (await api<{ operations: any[] }>('/api/settings/workspace/data/operations')).operations } catch { operations.value = [] } }
async function runMigration(action: 'preview' | 'migrate' | 'export') {
  busy.value = true
  error.value = ''
  try {
    const input = { source_workspace_id: migrationSource.value, target_workspace_id: migrationTarget.value, features: [...migrationFeatures.value], include_historical: false }
    if (action === 'preview') migrationPreview.value = await post('/api/settings/workspace/data/preview', input)
    else { const result = await post(`/api/settings/workspace/data/${action}`, input); operations.value = [result, ...operations.value]; migrationPreview.value = null; await loadMigrationDiscovery() }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '数据操作失败' }
  finally { busy.value = false }
}
async function checkUpdate() { try { update.value = await post('/api/system/update/check', {}); notice.value = '已检查更新' } catch (cause) { error.value = cause instanceof Error ? cause.message : '检查更新失败' } }
function toggleFeature(id: string) { if (migrationFeatures.value.has(id)) migrationFeatures.value.delete(id); else migrationFeatures.value.add(id) }
</script>

<template>
  <section><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <WorkspaceSettings v-if="section === 'workspace'" />
    <CapabilitiesSettings v-else-if="section === 'capabilities'" :pending="pending" :revision="revision" @change="emit('change', $event)" @loaded="emit('loaded', $event)" />
    <MemorySettings v-else-if="section === 'memory'" :pending="pending" :revision="revision" @change="emit('change', $event)" @loaded="emit('loaded', $event)" />
    <DocumentParsingSettings v-else-if="section === 'knowledge'" :pending="pending" :revision="revision" @change="emit('change', $event)" @loaded="emit('loaded', $event)" @engine-change="parsingEngine = $event" />
    <MinerUSettings v-if="section === 'knowledge' && parsingEngine === 'mineru'" :pending="mineruPending" :revision="revision" @change="emit('mineruChange', $event)" @loaded="emit('mineruLoaded', $event)" />
    <VideoLearningSettings v-else-if="section === 'video-learning'" :pending="pending" :revision="revision" @change="emit('change', $event)" @loaded="emit('loaded', $event)" />
    <template v-else-if="endpoints[section]"><header class="legacy-settings-page-header"><h1>{{ { capabilities: '能力', memory: '记忆', knowledge: '知识与文档', 'video-learning': '视频学习' }[section] }}</h1><p>{{ { capabilities: '配置各能力的模型参数与运行时选项。', memory: '分块、预算、去重与引用策略。', knowledge: '文档解析引擎与图片说明模型。', 'video-learning': '原生 YouTube 与本地 Invidious 播放供应商。' }[section] }}</p></header><div @input="changed" @change="changed"><EngineConfigForm v-model="data" /></div></template>
    <UsageSettings v-else-if="section === 'usage'" />
    <DataMigrationSettings v-else-if="section === 'data-migration'" />
    <template v-else-if="section === 'archive'"><ChatHistoryPage /></template>
    <AboutSettings v-else-if="section === 'about'" />
  </section>
</template>
