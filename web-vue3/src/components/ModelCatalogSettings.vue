<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, post } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import ModelTestPanel from './ModelTestPanel.vue'
import ServicePreviewPanel from './ServicePreviewPanel.vue'
import VoicePreviewPanel from './VoicePreviewPanel.vue'
import VoiceDiscoveryField from './VoiceDiscoveryField.vue'
import ModelFieldsEditor from './ModelFieldsEditor.vue'
import ProviderModelDiscovery from './ProviderModelDiscovery.vue'
import CodexOAuthCard from './CodexOAuthCard.vue'
import CodeBuddyAuthCard from './CodeBuddyAuthCard.vue'

type Model = { id: string; model?: string; name?: string; [key: string]: any }
type Profile = { id: string; name?: string; display_name?: string; models: Model[]; [key: string]: any }
type Choice = { mode?: string; selection?: { profile_id: string; model_id: string }; active_profile_id?: string | null; active_model_id?: string | null }
type OptionRow = { key: string; service: 'llm' | 'task'; profile: Profile; model: Model }

const props = withDefaults(defineProps<{ section: string; embedded?: boolean }>(), { embedded: false })
const catalog = ref<Record<string, any> | null>(null)
const taskKinds = ref<{ id: string; group: string }[]>([])
const editable = ref(false)
const activeProfileId = ref('')
const activeModelId = ref('')
const newProfile = ref({ id: '', name: '', provider: '', base_url: '', api_key: '', model_id: '' })
const newModelId = ref('')
const adding = ref(false)
const query = ref('')
const modelFilter = ref<'all' | 'default'>('all')
const activeConnectionIndex = ref(0)
const newConnection = ref({ name: '', provider: '', binding: '', base_url: '', api_key: '', api_version: '' })
const originalSignature = ref('')
const savedSignature = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const newConnectionId = () => window.crypto.randomUUID()
const service = computed(() => props.section === 'task-models' ? 'task' : props.section)
const PREVIEW_SERVICES = ['search', 'stt', 'imagegen', 'videogen']
const previewService = computed(() => PREVIEW_SERVICES.includes(props.section) ? (props.section as 'search' | 'stt' | 'imagegen' | 'videogen') : null)
const serviceConfig = computed(() => catalog.value?.services?.[service.value] || { profiles: [] })
const profiles = computed<Profile[]>(() => serviceConfig.value.profiles || [])
const activeProfile = computed<Profile | null>(() => profiles.value.find(profile => profile.id === activeProfileId.value) || profiles.value[0] || null)
const models = computed<Model[]>(() => activeProfile.value?.models || [])
const activeModel = computed<Model | null>(() => models.value.find(model => model.id === activeModelId.value) || models.value[0] || null)
const activeManaged = computed(() => Boolean(activeModel.value?.managed_by || activeProfile.value?.read_only || activeProfile.value?.managed_by))
function setVoice(value: string) { if (activeModel.value) activeModel.value.voice = value }
const probeInput = computed(() => {
  const profile = activeProfile.value
  if (!profile) return { binding: '', base_url: '' }
  return {
    binding: String(profile.binding || profile.provider || 'openai'),
    base_url: String(profile.base_url || ''),
    api_key: profile.api_key as string | undefined,
    api_format: (profile.api_format as string | undefined) || 'auto',
    api_version: String(profile.api_version || ''),
    extra_headers: profile.extra_headers as Record<string, string> | undefined,
    proxy: String(profile.proxy || ''),
    service: service.value,
    profile_id: profile.id,
  }
})
function addDiscoveredModels(ids: string[]) {
  if (!activeProfile.value) return
  for (const id of ids) {
    const modelId = id.trim()
    if (!modelId || activeProfile.value.models.some(existing => existing.id === modelId || existing.model === modelId)) continue
    activeProfile.value.models.push({ id: modelId, model: modelId, name: modelId })
  }
  syncSelection()
}
function pickDiscoveredModel(id: string) {
  if (!activeProfile.value) return
  const modelId = id.trim()
  if (!modelId) return
  if (!activeProfile.value.models.some(existing => existing.id === modelId)) {
    activeProfile.value.models.push({ id: modelId, model: modelId, name: modelId })
  }
  activeModelId.value = modelId
  syncSelection()
}
const serviceName = computed(() => ({ connections: '提供方', llm: '语言模型', task: '后台任务模型', embedding: '嵌入模型', search: '搜索', tts: '语音合成', stt: '语音识别', imagegen: '图片生成', videogen: '视频生成' } as Record<string, string>)[service.value] || '模型设置')
const taskOptions = computed<OptionRow[]>(() => {
  if (!catalog.value) return []
  return (['llm', 'task'] as const).flatMap(optionService => ((catalog.value?.services?.[optionService]?.profiles || []) as Profile[]).flatMap(profile => (profile.models || []).filter(model => model.model).map(model => ({ key: `${optionService}:${profile.id}:${model.id}`, service: optionService, profile, model }))))
})
const pageDescription = computed(() => ({ connections: '管理提供方的名称、地址、密钥并测试连接。', llm: '管理语言模型、上下文窗口、模型能力与连接测试。', task: '选择 DeepTutor 自动任务使用的模型。', embedding: '管理嵌入模型、维度和连接测试。', search: '管理联网搜索提供方。', tts: '管理语音合成模型、声音和连接测试。', stt: '管理语音识别模型和连接测试。', imagegen: '管理图片生成模型和连接测试。', videogen: '管理视频生成模型和连接测试。' } as Record<string, string>)[service.value] || '')
const globalTaskValue = computed(() => choiceValue(catalog.value?.services?.task, 'inherit'))

const catalogSignature = computed(() => JSON.stringify(catalog.value))
const catalogDirty = computed(() => Boolean(originalSignature.value && catalogSignature.value !== originalSignature.value))
const draftSaved = computed(() => catalogDirty.value && savedSignature.value === catalogSignature.value)
const railRows = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return profiles.value.flatMap(profile => {
    const rows = service.value === 'search' ? [{ profile, model: null as Model | null }] : (profile.models || []).map(model => ({ profile, model: model as Model | null }))
    return rows.filter(row => {
      if (modelFilter.value === 'default' && (serviceConfig.value.active_profile_id !== row.profile.id || (row.model && serviceConfig.value.active_model_id !== row.model.id))) return false
      return !needle || `${row.profile.name || row.profile.id} ${row.profile.provider || ''} ${row.model ? modelLabel(row.model) : ''}`.toLocaleLowerCase().includes(needle)
    })
  })
})
const activeConnection = computed(() => catalog.value?.connections?.[activeConnectionIndex.value] || null)
const activeConnectionBinding = computed(() => String(activeConnection.value?.binding || activeConnection.value?.provider || '').toLowerCase())
function onOAuthCatalogChanged() {
  // OAuth login/logout rewrites the server-side catalog; refresh only when the
  // local copy is clean so unsaved provider edits are never overwritten.
  if (!catalogDirty.value) void load()
}
const filteredConnections = computed(() => (catalog.value?.connections || []).map((connection: Record<string, any>, index: number) => ({ connection, index })).filter((row: { connection: Record<string, string>; index: number }) => `${row.connection.name} ${row.connection.provider} ${row.connection.binding}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
function modelLabel(model: Model) { return model.name || model.model || model.id }
function choiceValue(choice: Choice | null | undefined, fallback: string) {
  if (!choice) return fallback
  if (choice.mode === 'inherit') return 'inherit'
  if (choice.mode === 'reference') return choice.selection?.profile_id && choice.selection.model_id ? `llm:${choice.selection.profile_id}:${choice.selection.model_id}` : fallback
  if (choice.mode === 'profiles') return choice.active_profile_id && choice.active_model_id ? `task:${choice.active_profile_id}:${choice.active_model_id}` : fallback
  return fallback
}
function overrideValue(kind: string) { return choiceValue(catalog.value?.services?.task?.overrides?.[kind], 'global') }
function setTaskChoice(value: string, kind?: string) {
  if (!catalog.value) return
  const task = catalog.value.services.task
  let choice: Choice | null = null
  if (value === 'inherit') choice = { mode: 'inherit' }
  else if (value !== 'global') {
    const [optionService, profileId, modelId] = value.split(':')
    choice = optionService === 'llm'
      ? { mode: 'reference', selection: { profile_id: profileId, model_id: modelId } }
      : { mode: 'profiles', active_profile_id: profileId, active_model_id: modelId }
  }
  if (kind) {
    task.overrides ||= {}
    if (choice) task.overrides[kind] = choice
    else delete task.overrides[kind]
  } else if (choice) {
    task.mode = choice.mode
    if (choice.mode === 'reference') task.selection = choice.selection
    else {
      delete task.selection
      if (choice.mode === 'profiles') {
        task.active_profile_id = choice.active_profile_id
        task.active_model_id = choice.active_model_id
      }
    }
  }
}
async function load() {
  error.value = ''
  try {
    const [settings, stored] = await Promise.all([api<any>('/api/settings'), api<any>('/api/settings/draft').catch(() => null)])
    const selected = stored?.draft?.catalog || settings.catalog
    catalog.value = selected || null
    editable.value = Boolean(settings.catalog)
    taskKinds.value = settings.task_kinds || []
    if (!editable.value || !catalog.value) return
    catalog.value.services ||= {}
    catalog.value.services[service.value] ||= { active_profile_id: null, active_model_id: null, profiles: [] }
    catalog.value.services[service.value].profiles ||= []
    const config = catalog.value.services[service.value]
    activeProfileId.value = config.active_profile_id || config.profiles[0]?.id || ''
    activeModelId.value = config.active_model_id || config.profiles[0]?.models?.[0]?.id || ''
    originalSignature.value = JSON.stringify(settings.catalog)
    savedSignature.value = stored?.draft?.catalog ? originalSignature.value : ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '模型设置加载失败' }
}
onMounted(load)
function syncSelection() {
  if (!catalog.value) return
  catalog.value.services[service.value].active_profile_id = activeProfileId.value || null
  if (service.value !== 'search') catalog.value.services[service.value].active_model_id = activeModelId.value || null
}
function selectProfile() {
  activeModelId.value = activeProfile.value?.models?.[0]?.id || ''
  syncSelection()
}
function selectRail(row: { profile: Profile; model: Model | null }) {
  adding.value = false
  activeProfileId.value = row.profile.id
  activeModelId.value = row.model?.id || ''
  syncSelection()
}
function openAdding() { adding.value = true; error.value = ''; notice.value = '' }
function addProfile() {
  if (!catalog.value || !newProfile.value.id.trim() || (service.value !== 'search' && !newProfile.value.model_id.trim())) return
  const id = newProfile.value.id.trim()
  const modelId = newProfile.value.model_id.trim()
  const profile: Profile = {
    id, name: newProfile.value.name || id, provider: newProfile.value.provider, binding: newProfile.value.provider,
    base_url: newProfile.value.base_url, api_key: newProfile.value.api_key, api_version: '',
    models: service.value === 'search' ? [] : [{ id: modelId, model: modelId, name: modelId }],
  }
  catalog.value.services[service.value].profiles.push(profile)
  activeProfileId.value = id
  activeModelId.value = modelId
  syncSelection()
  newProfile.value = { id: '', name: '', provider: '', base_url: '', api_key: '', model_id: '' }
  adding.value = false
}
function addConnection() {
  if (!catalog.value) return
  const connections = catalog.value.connections ||= []
  connections.push({ id: newConnectionId(), ...newConnection.value })
  activeConnectionIndex.value = connections.length - 1
  newConnection.value = { name: '', provider: '', binding: '', base_url: '', api_key: '', api_version: '' }
  adding.value = false
}
function removeConnection(index: number) {
  catalog.value?.connections?.splice(index, 1)
  activeConnectionIndex.value = Math.max(0, Math.min(activeConnectionIndex.value, (catalog.value?.connections?.length || 1) - 1))
}
function removeProfile() {
  if (!activeProfile.value || profiles.value.length <= 1) return
  catalog.value!.services[service.value].profiles = profiles.value.filter(profile => profile.id !== activeProfile.value?.id)
  activeProfileId.value = profiles.value[0]?.id || ''
  activeModelId.value = profiles.value[0]?.models?.[0]?.id || ''
  syncSelection()
}
function addModel() {
  if (!activeProfile.value || !newModelId.value.trim()) return
  const id = newModelId.value.trim()
  if (activeProfile.value.models.some(model => model.id === id || model.model === id)) { error.value = '该模型已存在'; return }
  activeProfile.value.models.push({ id, model: id, name: id })
  activeModelId.value = id
  syncSelection()
  newModelId.value = ''
}
function adoptDetected(value: { context_window?: string; context_window_source?: string; context_window_detected_at?: string; dimension?: string; supported_dimensions?: string }) {
  const target = models.value.find(model => model.id === activeModelId.value)
  if (target) Object.assign(target, value)
}
function removeModel(model: Model) {
  if (!activeProfile.value || activeProfile.value.models.length <= 1) return
  activeProfile.value.models = activeProfile.value.models.filter(item => item.id !== model.id)
  if (activeModelId.value === model.id) activeModelId.value = activeProfile.value.models[0]?.id || ''
  syncSelection()
}
async function saveDraft() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    syncSelection()
    await api('/api/settings/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalog: catalog.value, extensions: {} }) })
    savedSignature.value = catalogSignature.value
    notice.value = '草稿已保存，尚未应用'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存草稿失败' }
  finally { busy.value = false }
}
async function apply() {
  await saveDraft()
  if (error.value) return
  busy.value = true
  try {
    if (props.section === 'connections') await post('/api/settings/apply', { catalog: catalog.value })
    else await post('/api/settings/apply/service', { service: service.value, config: serviceConfig.value })
    originalSignature.value = catalogSignature.value
    savedSignature.value = ''
    notice.value = '模型配置已应用'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '应用配置失败' }
  finally { busy.value = false }
}

async function discard() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await api('/api/settings/draft', { method: 'DELETE' })
    savedSignature.value = ''
    adding.value = false
    await load()
    notice.value = '已放弃草稿'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '放弃草稿失败' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="model-catalog-settings">
    <header v-if="!embedded" class="model-page-header"><h1>{{ serviceName }}</h1><p>{{ pageDescription }}</p></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!editable" class="muted">当前部署未返回可编辑的个人模型目录。你可以添加自己的模型，也可以使用管理员分配的模型。</p>
    <template v-else-if="catalog">
      <div v-if="section !== 'connections' && section !== 'task-models' && !catalog.connections?.length" class="model-provider-empty"><p>添加模型前，请先添加提供方。</p><RouterLink to="/settings/connections">前往提供方</RouterLink></div>
      <div class="model-workspace" :class="{ 'task-workspace': section === 'task-models' }">
        <aside v-if="section !== 'task-models'" class="model-workspace-rail">
          <button class="model-add-button" @click="openAdding"><LegacyIcon name="plus" :size="14" />{{ section === 'connections' ? '添加提供方' : '添加模型' }}</button>
          <label class="model-rail-search"><LegacyIcon name="search" :size="14" /><input v-model="query" :aria-label="section === 'connections' ? '查找提供方' : '搜索模型'" :placeholder="section === 'connections' ? '按名称搜索' : '搜索模型'"></label>
          <div class="model-rail-list">
            <template v-if="section === 'connections'">
              <button v-for="row in filteredConnections" :key="row.connection.id || row.index" class="model-rail-card" :class="{ active: !adding && activeConnectionIndex === row.index }" @click="adding = false; activeConnectionIndex = row.index"><strong>{{ row.connection.name || '未命名提供方' }}</strong><span>{{ row.connection.provider || row.connection.binding || '自定义提供方' }}</span><small>{{ row.connection.base_url || '默认地址' }}</small></button>
            </template>
            <template v-else-if="section !== 'task-models'">
              <button v-for="row in railRows" :key="`${row.profile.id}:${row.model?.id || 'search'}`" class="model-rail-card" :class="{ active: !adding && activeProfileId === row.profile.id && (!row.model || activeModelId === row.model.id) }" @click="selectRail(row)"><span class="model-rail-title"><strong>{{ row.model ? modelLabel(row.model) : row.profile.name || row.profile.id }}</strong><small v-if="serviceConfig.active_profile_id === row.profile.id && (!row.model || serviceConfig.active_model_id === row.model.id)">✓ 默认</small></span><span>{{ row.profile.name || row.profile.id }}<template v-if="row.model?.model"> · {{ row.model.model }}</template></span><small>{{ serviceName }}</small></button>
            </template>
            <p v-if="section === 'connections' && !filteredConnections.length" class="model-rail-empty">{{ catalog.connections?.length ? '没有匹配的提供方。' : '添加首个提供方以开始配置模型。' }}</p><p v-else-if="section !== 'task-models' && !railRows.length" class="model-rail-empty">{{ profiles.length ? '没有匹配的模型。' : '尚未配置模型。' }}</p>
          </div>
        </aside>
        <section class="model-workspace-detail">
          <template v-if="adding">
            <div v-if="section === 'connections'" class="model-editor-card"><header><h2>添加提供方</h2><p>配置连接名称、地址和凭据。</p></header><div class="model-form-grid"><label>名称<input v-model="newConnection.name" placeholder="我的提供方"></label><label>提供方<input v-model="newConnection.provider" placeholder="openai"></label><label>绑定标识<input v-model="newConnection.binding" placeholder="openai"></label><label>Base URL<input v-model="newConnection.base_url" placeholder="https://api.example.com/v1"></label><label>API Key<input v-model="newConnection.api_key" type="password"></label><label>API 版本<input v-model="newConnection.api_version"></label></div><div class="model-editor-actions"><button @click="adding = false">取消</button><button class="primary" @click="addConnection">添加提供方</button></div></div>
            <div v-else class="model-editor-card"><header><h2>添加 Profile</h2><p>选择提供方并添加首个模型。</p></header><div class="model-form-grid"><label>Profile ID<input v-model="newProfile.id" aria-label="Profile ID" placeholder="Profile ID"></label><label>显示名称<input v-model="newProfile.name" placeholder="显示名称" aria-label="Profile 显示名称"></label><label>提供方<input v-model="newProfile.provider" placeholder="提供方" aria-label="Profile 提供方"></label><label>Base URL<input v-model="newProfile.base_url" placeholder="Base URL" aria-label="Profile Base URL"></label><label>API Key<input v-model="newProfile.api_key" type="password" placeholder="API Key" aria-label="Profile API Key"></label><label v-if="section !== 'search'">首个模型 ID<input v-model="newProfile.model_id" placeholder="首个模型 ID" aria-label="首个模型 ID"></label></div><div class="model-editor-actions"><button @click="adding = false">取消</button><button class="primary" @click="addProfile">添加 Profile</button></div></div>
          </template>
          <template v-else-if="section === 'connections' && activeConnection">
            <CodexOAuthCard v-if="activeConnectionBinding === 'openai_codex'" @catalog-changed="onOAuthCatalogChanged" />
            <CodeBuddyAuthCard v-else-if="activeConnectionBinding === 'codebuddy'" @catalog-changed="onOAuthCatalogChanged" />
            <div class="model-editor-card"><header><p>正在配置提供方</p><h2>{{ activeConnection.name || '未命名提供方' }}</h2><span>{{ activeConnection.provider || activeConnection.binding }}</span></header><div class="model-form-grid"><label>名称<input v-model="activeConnection.name"></label><label>提供方<input v-model="activeConnection.provider"></label><label>绑定标识<input v-model="activeConnection.binding" placeholder="openai"></label><label>Base URL<input v-model="activeConnection.base_url"></label><label>API Key<input v-model="activeConnection.api_key" type="password"></label><label>API 版本<input v-model="activeConnection.api_version"></label></div><div class="model-editor-actions"><button class="danger" @click="removeConnection(activeConnectionIndex)">删除提供方</button></div></div></template>
          <template v-else-if="section === 'task-models'"><div class="model-editor-card"><header><h2>全局任务模型</h2><p>控制 DeepTutor 自动发起的后台任务调用。</p></header><label>后台任务模型<select :value="globalTaskValue" aria-label="后台任务模型" @change="setTaskChoice(($event.target as HTMLSelectElement).value)"><option value="inherit">跟随对话模型</option><option v-for="row in taskOptions" :key="row.key" :value="row.key">{{ modelLabel(row.model) }} · {{ row.profile.name || row.profile.id }}</option></select></label></div><div v-if="taskKinds.length" class="model-editor-card"><header><h2>任务模型覆盖</h2><p>为特定任务选择不同模型，或跟随全局设置。</p></header><div v-for="kind in taskKinds" :key="kind.id" class="model-task-row"><span>{{ kind.group }} · {{ kind.id }}</span><select :value="overrideValue(kind.id)" :aria-label="`${kind.id} 任务模型`" @change="setTaskChoice(($event.target as HTMLSelectElement).value, kind.id)"><option value="global">跟随全局任务模型</option><option value="inherit">跟随对话模型</option><option v-for="row in taskOptions" :key="row.key" :value="row.key">{{ modelLabel(row.model) }} · {{ row.profile.name || row.profile.id }}</option></select></div></div></template>
          <template v-else-if="activeProfile"><div class="model-editor-card model-editor"><header><p>正在配置模型</p><h2>{{ activeProfile.name || activeProfile.id }}</h2><span>{{ activeProfile.provider || activeProfile.binding }}</span></header><div class="model-form-grid"><label>名称<input v-model="activeProfile.name"></label><label>提供方<input v-model="activeProfile.provider"></label><label>绑定标识<input v-model="activeProfile.binding" placeholder="openai"></label><label>Base URL<input v-model="activeProfile.base_url"></label><label>API Key<input v-model="activeProfile.api_key" type="password"></label><label>API 版本<input v-model="activeProfile.api_version"></label></div><div class="model-editor-actions"><button class="danger" :disabled="profiles.length <= 1" @click="removeProfile">删除当前 Profile</button></div></div>
            <div v-if="section !== 'search'" class="model-editor-card"><header><h2>当前 Profile 的模型</h2><p>编辑模型 ID，或将其他模型添加到此 Profile。</p></header><div class="model-add-inline"><input v-model="newModelId" aria-label="新模型 ID" placeholder="新模型 ID"><button @click="addModel">添加模型</button></div><div class="model-list"><div v-for="model in models" :key="model.id" :class="{ active: activeModelId === model.id }"><button class="model-select" @click="activeModelId = model.id; syncSelection()"><strong>{{ modelLabel(model) }}</strong><small>{{ model.model }}</small></button><button class="danger" :disabled="models.length <= 1" @click="removeModel(model)">删除</button></div></div></div>
            <div v-if="activeProfile && section !== 'task-models' && section !== 'search'" class="model-editor-card model-discovery-card">
              <header><h2>从提供方发现模型</h2><span>使用当前 Profile 的地址与凭据拉取可用模型</span></header>
              <div class="model-discovery-body">
                <ProviderModelDiscovery :key="`${activeProfile.id}:${probeInput.base_url}`" :input="probeInput" pick-many
                                        :selected-models="models.map(item => item.model || item.id)"
                                        @pick="pickDiscoveredModel" @pick-many="addDiscoveredModels" />
              </div>
            </div>
            <div v-if="activeProfile && activeModel && section !== 'task-models' && section !== 'search'" class="model-editor-card model-fields-card">
              <header><h2>模型参数</h2><span>{{ modelLabel(activeModel) }} · {{ activeModel.model || activeModel.id }}</span></header>
              <div class="model-fields-body">
                <ModelFieldsEditor :service="service" :profile="activeProfile" :model="activeModel" :binding="activeProfile.binding || activeProfile.provider" />
              </div>
            </div>
            <ModelTestPanel v-if="activeProfile && section !== 'task-models'" :catalog="catalog" :service="service" :profile="activeProfile" :model="section === 'search' ? null : models.find(model => model.id === activeModelId) || models[0]" @adopt="adoptDetected" />
            <ServicePreviewPanel v-if="activeProfile && previewService" :service="previewService" :profile-id="activeProfile.id" :model-id="(section === 'search' ? null : models.find(model => model.id === activeModelId) || models[0])?.id" :catalog="catalog" />
            <div v-if="activeProfile && activeModel && section === 'tts'" class="model-editor-card voice-discovery-card">
              <div class="model-fields-body">
                <VoiceDiscoveryField :catalog="catalog" :profile-id="activeProfile.id" :model-id="activeModel.id" :model-value="String(activeModel.voice ?? '')" :disabled="activeManaged" @update:model-value="setVoice" />
              </div>
            </div>
            <VoicePreviewPanel v-if="activeProfile && section === 'tts'" :profile-id="activeProfile.id" :model-id="(models.find(model => model.id === activeModelId) || models[0])?.id" :catalog="catalog" :model="(models.find(model => model.id === activeModelId) || models[0]) as Record<string, unknown> | undefined" />
          </template>
          <div v-else class="model-detail-empty"><LegacyIcon name="settings" :size="20" /><h2>尚未选择</h2><p>选择一个模型，查看并编辑参数、测试连接。</p></div>
        </section>
      </div>
      <div v-if="catalogDirty" class="model-catalog-toolbar"><div><strong>{{ draftSaved ? '草稿尚未应用' : '有未保存的更改' }}</strong><p>{{ notice || '应用所有模型设置页面中的待处理更改。' }}</p></div><div><button :disabled="busy" @click="discard"><LegacyIcon name="undo" :size="14" />放弃</button><button :disabled="busy || draftSaved" @click="saveDraft"><LegacyIcon name="save" :size="14" />存草稿</button><button class="primary" :disabled="busy" @click="apply"><LegacyIcon name="check" :size="14" />应用更改</button></div></div><div v-else-if="notice" class="model-catalog-toast" role="status">{{ notice }}</div>
    </template>
  </section>
</template>
