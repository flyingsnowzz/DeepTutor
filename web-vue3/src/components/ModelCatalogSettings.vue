<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import ModelTestPanel from './ModelTestPanel.vue'
import ServicePreviewPanel from './ServicePreviewPanel.vue'
import VoicePreviewPanel from './VoicePreviewPanel.vue'
import VoiceDiscoveryField from './VoiceDiscoveryField.vue'
import ModelFieldsEditor from './ModelFieldsEditor.vue'
import EmbeddingModelUsage from './EmbeddingModelUsage.vue'
import ProviderModelDiscovery from './ProviderModelDiscovery.vue'
import CodexOAuthCard from './CodexOAuthCard.vue'
import CodeBuddyAuthCard from './CodeBuddyAuthCard.vue'
import ProviderConnectionAdvanced from './ProviderConnectionAdvanced.vue'
import ProviderServices from './ProviderServices.vue'
import AddProviderPanel from './AddProviderPanel.vue'
import ProviderIcon from './ProviderIcon.vue'
import { formatConfiguredProviderName, formatProviderLabel } from '../providerBranding'
import { PROVIDER_SERVICES, providerServiceSupport } from '../providerSupport'

type Model = { id: string; model?: string; name?: string; [key: string]: any }
type Profile = { id: string; name?: string; display_name?: string; models: Model[]; [key: string]: any }
type Choice = { mode?: string; selection?: { profile_id: string; model_id: string }; active_profile_id?: string | null; active_model_id?: string | null }
type OptionRow = { key: string; service: 'llm' | 'task'; profile: Profile; model: Model }
type TaskText = { label: { zh: string; en: string }; detail: { zh: string; en: string } }

const TASK_TEXT: Record<string, TaskText> = {
  session_title: {
    label: { zh: '对话标题', en: 'Conversation titles' },
    detail: { zh: '根据开头的一问一答给对话起名。', en: 'Names a conversation from its opening exchange.' },
  },
  chat_starters: {
    label: { zh: '开场建议', en: 'Starter suggestions' },
    detail: { zh: '为空白输入框下方的开场建议撰写内容。', en: 'Writes the openings offered under an empty composer.' },
  },
  chat_ask_hint: {
    label: { zh: '输入框提示', en: 'Composer hint' },
    detail: { zh: '预测你接下来最可能输入的那句话。', en: 'Predicts the line you are likely to type next.' },
  },
  mastery_goal_name: {
    label: { zh: '精通目标名称', en: 'Mastery goal names' },
    detail: { zh: '把你想学的内容浓缩成一个短名字。', en: 'Turns what you asked to learn into a short name.' },
  },
  mastery_ask_hint: {
    label: { zh: '学习输入框提示', en: 'Study composer hint' },
    detail: { zh: '针对当前路标给出一个可以追问的问题。', en: 'Offers a question to ask about the current waypoint.' },
  },
  reading_ask_hint: {
    label: { zh: '阅读输入框提示', en: 'Reading composer hint' },
    detail: { zh: '结合当前页面的内容给出一个可以追问的问题。', en: 'Offers a question grounded in the page you are on.' },
  },
  reading_vocabulary: {
    label: { zh: '词汇讲解', en: 'Vocabulary help' },
    detail: { zh: '讲解你在阅读时选中的词或短语。', en: 'Explains a word or phrase you selected while reading.' },
  },
  reading_translation: {
    label: { zh: '翻译', en: 'Translation' },
    detail: { zh: '翻译你在阅读时选中的段落。', en: 'Translates a passage you selected while reading.' },
  },
  reading_guidance: {
    label: { zh: '学习指引', en: 'Study guidance' },
    detail: { zh: '建议如何读完当前这一节。', en: 'Suggests how to work through the section you are reading.' },
  },
  reading_quiz: {
    label: { zh: '阅读练习题', en: 'Reading questions' },
    detail: { zh: '根据正在阅读的内容出练习题。', en: 'Writes practice questions from what you are reading.' },
  },
}
const GROUP_TEXT: Record<string, { zh: string; en: string }> = {
  chat: { zh: '对话', en: 'Conversation' },
  mastery: { zh: '精通之路', en: 'Mastery path' },
  reading: { zh: '沉浸式阅读', en: 'Immersive reading' },
}

const props = withDefaults(defineProps<{ section: string; embedded?: boolean; applying?: boolean; pendingCatalog?: Record<string, any> | null; pendingCodexReasoning?: Record<string, string | null>; revision?: number; language?: string }>(), { embedded: false, applying: false })
const route = useRoute()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const emit = defineEmits<{ catalogChanged: [value: Record<string, any>]; codexReasoningChanged: [value: Record<string, string | null>]; codexReasoningLoaded: [value: Record<string, string | null>] }>()
const copyCatalog = (value: Record<string, any>) => JSON.parse(JSON.stringify(value)) as Record<string, any>
const catalog = ref<Record<string, any> | null>(null)
const taskKinds = ref<{ id: string; group: string }[]>([])
type ProviderOption = { value: string; label?: string; status?: string; base_url?: string; base_urls?: Record<string, string>; default_api_format?: string; api_formats?: string[]; requires_api_key?: boolean }
const providerOptions = ref<Record<string, ProviderOption[]>>({})
const connectionTargets = ref<Array<{ provider: string; services?: Record<string, unknown> }>>([])
const editable = ref(false)
const activeProfileId = ref('')
const activeModelId = ref('')
const newProfile = ref({ id: '', name: '', provider: '', base_url: '', api_key: '', model_id: '' })
const newModelId = ref('')
const adding = ref(false)
const authAdding = ref(false)
const editingConnectionName = ref(false)
const query = ref('')
const modelFilter = ref<'all' | 'default'>('all')
const activeConnectionIndex = ref(0)
const originalSignature = ref('')
const hydrating = ref(false)
const loading = ref(true)
const error = ref('')
const savedConnectionIds = ref<Set<string>>(new Set())
let loadVersion = 0
const newConnectionId = () => window.crypto.randomUUID()
function applyRouteProvider() {
  if (props.section !== 'connections') return
  const wanted = String(route.query.provider || '')
  if (!wanted.startsWith('connection:')) return
  const connectionId = wanted.slice('connection:'.length)
  const index = (catalog.value?.connections || []).findIndex((connection: Record<string, any>) => connection.id === connectionId)
  if (index >= 0) selectConnection(index)
}
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
const serviceName = computed(() => ({ connections: tr('提供方', 'Providers'), llm: tr('语言模型', 'Language models'), task: tr('后台任务模型', 'Task models'), embedding: tr('嵌入模型', 'Embedding models'), search: tr('搜索', 'Search'), tts: tr('语音合成', 'Text-to-Speech'), stt: tr('语音识别', 'Speech-to-Text'), imagegen: tr('图片生成', 'Image Generation'), videogen: tr('视频生成', 'Video Generation') } as Record<string, string>)[service.value] || tr('模型设置', 'Model settings'))
const taskOptions = computed<OptionRow[]>(() => {
  if (!catalog.value) return []
  return (['llm', 'task'] as const).flatMap(optionService => ((catalog.value?.services?.[optionService]?.profiles || []) as Profile[]).filter(profile => !profile.provider_only).flatMap(profile => (profile.models || []).filter(model => model.model).map(model => ({ key: `${optionService}:${profile.id}:${model.id}`, service: optionService, profile, model }))))
})
const pageDescription = computed(() => ({ connections: tr('管理提供方的名称、地址和密钥，再前往各类模型页面配置模型。', 'Manage provider names, addresses, and credentials, then configure models on each model page.'), llm: tr('管理语言模型、上下文窗口、模型能力与连接测试。', 'Manage language models, context windows, capabilities, and connection tests.'), task: tr('DeepTutor 自己发起的调用（对话标题、开场建议、划词查询等）使用的模型。可以统一配置一个，也可以给单个任务单独指定。', 'The model behind the calls DeepTutor makes on its own — titles, suggestions, lookups. Set one for all of them, or give a task its own.'), embedding: tr('管理嵌入模型、维度和连接测试。', 'Manage embedding models, dimensions, and connection tests.'), search: tr('管理联网搜索提供方。', 'Manage web search providers.'), tts: tr('管理语音合成模型、声音和连接测试。', 'Manage speech synthesis models, voices, and connection tests.'), stt: tr('管理语音识别模型和连接测试。', 'Manage speech transcription models and connection tests.'), imagegen: tr('管理图片生成模型和连接测试。', 'Manage image generation models and connection tests.'), videogen: tr('管理视频生成模型和连接测试。', 'Manage video generation models and connection tests.') } as Record<string, string>)[service.value] || '')
const globalTaskValue = computed(() => {
  const task = catalog.value?.services?.task
  if (!task) return 'inherit'
  return choiceValue({ ...task, mode: task.mode ?? (task.profiles?.length ? 'profiles' : 'inherit') }, 'inherit')
})
const taskGroups = computed(() => {
  const groups: { group: string; kinds: string[] }[] = []
  for (const kind of taskKinds.value) {
    const existing = groups.find(entry => entry.group === kind.group)
    if (existing) existing.kinds.push(kind.id)
    else groups.push({ group: kind.group, kinds: [kind.id] })
  }
  return groups
})

const catalogSignature = computed(() => JSON.stringify(catalog.value))
const catalogDirty = computed(() => Boolean(originalSignature.value && catalogSignature.value !== originalSignature.value))
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
const addableProviders = computed(() => {
  const rows = new Map<string, { value: string; label?: string; services: string[]; service: string; default_api_format?: string }>()
  for (const [service, options] of Object.entries(providerOptions.value)) {
    for (const option of options) {
      if (option.value === 'none' || option.status === 'deprecated' || option.status === 'legacy') continue
      const row = rows.get(option.value)
      if (row) { if (!row.services.includes(service)) row.services.push(service) }
      else rows.set(option.value, { value: option.value, label: option.label || option.value, services: [service], service, default_api_format: (option as any).default_api_format })
    }
  }
  if (!rows.has('custom')) rows.set('custom', { value: 'custom', label: tr('自定义', 'Custom'), services: [], service: 'llm', default_api_format: 'openai_chat' })
  return [...rows.values()].sort((a, b) => (a.label || a.value).localeCompare(b.label || b.value))
})
const activeConnectionBinding = computed(() => String(activeConnection.value?.binding || activeConnection.value?.provider || '').toLowerCase())
const activeProviderOption = computed(() => providerOptions.value[activeConnection.value?.source_service || 'llm']?.find(option => option.value === activeConnection.value?.provider)
  || Object.values(providerOptions.value).flat().find(option => option.value === activeConnection.value?.provider))
const connectionDefaultBaseUrl = computed(() => activeProviderOption.value?.base_urls?.[activeConnection.value?.api_format || activeProviderOption.value?.default_api_format || 'auto'] || activeProviderOption.value?.base_url || '')
const connectionHints = computed(() => {
  const provider = activeConnection.value?.provider
  const targets = connectionTargets.value.find(target => target.provider === provider)?.services || {}
  const enabled = (service: string) => activeConnection.value?.service_overrides?.[service]?.enabled ?? Boolean(targets[service] || providerOptions.value[service]?.some(option => option.value === provider))
  return [
    enabled('llm') ? 'llm' : '', enabled('embedding') ? 'embedding' : '', enabled('search') ? 'search' : '',
    enabled('tts') || enabled('stt') ? 'voice' : '', enabled('imagegen') || enabled('videogen') ? 'generation' : '',
  ].filter(Boolean)
})
const connectionProbeInput = computed(() => ({
  binding: String(activeConnection.value?.binding || activeConnection.value?.provider || ''),
  base_url: String(activeConnection.value?.base_url || connectionDefaultBaseUrl.value),
  api_key: activeConnection.value?.api_key,
  api_format: String(activeConnection.value?.api_format || 'auto'),
  api_version: String(activeConnection.value?.api_version || ''),
  extra_headers: activeConnection.value?.extra_headers,
  proxy: String(activeConnection.value?.proxy || ''),
  service: String(activeConnection.value?.source_service || 'llm'),
  connection_id: activeConnection.value?.id,
}))
const activeConnectionUsage = computed(() => {
  const id = activeConnection.value?.id
  if (!id) return 0
  let count = 0
  for (const [service, config] of Object.entries(catalog.value?.services || {})) {
    if (service === 'task') continue
    for (const profile of (config as { profiles?: Profile[] }).profiles || []) {
      if (profile.provider_only) continue
      const rows = service === 'search' ? [null] : profile.models || []
      for (const model of rows) {
        const ref = model?.provider_ref || profile.provider_ref || (profile.connection_id ? { connection_id: profile.connection_id } : null)
        if (ref?.connection_id === id) count++
      }
    }
  }
  return count
})
const connectionServiceTitles: Record<string, { zh: string; en: string }> = {
  llm: { zh: '语言模型', en: 'Language models' },
  embedding: { zh: '嵌入模型', en: 'Embedding models' },
  tts: { zh: '语音合成', en: 'Text-to-Speech' },
  stt: { zh: '语音识别', en: 'Speech-to-Text' },
  imagegen: { zh: '文生图', en: 'Image Generation' },
  videogen: { zh: '文生视频', en: 'Video Generation' },
  search: { zh: '搜索', en: 'Search' },
}
function connectionDisplayName(connection: Record<string, any>) {
  return formatConfiguredProviderName(String(connection.provider || 'custom'), String(connection.name || connection.provider || tr('未命名提供方', 'Unnamed provider')), props.language || 'zh')
}
function providerKindLabel(connection: Record<string, any>) {
  const provider = String(connection.provider || 'custom')
  if (provider === 'custom') {
    const format = String(connection.api_format || activeProviderOption.value?.default_api_format || 'openai_chat')
    const formatLabel = format === 'openai_responses' ? 'OpenAI Responses' : format === 'anthropic' ? 'Anthropic Messages' : 'OpenAI API'
    return tr(`自定义（${formatLabel}）`, `Custom (${formatLabel})`)
  }
  return formatProviderLabel(provider, provider, props.language || 'zh')
}
function connectionServiceTags(connection: Record<string, any>) {
  return PROVIDER_SERVICES
    .filter(item => providerServiceSupport(connection, item, connectionTargets.value, providerOptions.value as any).enabled)
    .map(item => connectionServiceTitles[item])
}
function connectionUsage(connection: Record<string, any>) {
  let count = 0
  for (const [bucket, config] of Object.entries(catalog.value?.services || {})) {
    if (bucket === 'task') continue
    for (const profile of (config as { profiles?: Profile[] }).profiles || []) {
      if (profile.provider_only) continue
      const rows = bucket === 'search' ? [null] : profile.models || []
      for (const model of rows) {
        const ref = model?.provider_ref || profile.provider_ref || (profile.connection_id ? { connection_id: profile.connection_id } : null)
        if (ref?.connection_id === connection.id) count += 1
      }
    }
  }
  return count
}
function updateConnectionApiKey(index: number, value: string) {
  if (!activeConnection.value) return
  if (Array.isArray(activeConnection.value.api_key)) activeConnection.value.api_key[index] = value
  else activeConnection.value.api_key = value
  delete activeConnection.value.discovery
}
function updateActiveConnection(field: string, value: unknown) {
  if (!activeConnection.value) return
  activeConnection.value[field] = value
  if (!['name', 'discovery', 'service_overrides'].includes(field)) delete activeConnection.value.discovery
}
function updateConnectionBaseUrl(event: Event) {
  updateActiveConnection('base_url', (event.target as HTMLInputElement).value)
}
const connectionRelatedLinks = computed(() => {
  if (!activeConnection.value) return []
  const enabled = (item: string) => providerServiceSupport(activeConnection.value!, item as any, connectionTargets.value, providerOptions.value as any).enabled
  return [
    { path: 'llm', zh: '语言模型', en: 'Language models', show: enabled('llm') },
    { path: 'embedding', zh: '嵌入模型', en: 'Embedding models', show: enabled('embedding') },
    { path: 'search', zh: '搜索', en: 'Search', show: enabled('search') },
    { path: 'voice', zh: '语音', en: 'Voice', show: enabled('tts') || enabled('stt') },
    { path: 'multimodal', zh: '多模态生成', en: 'Multimodal generation', show: enabled('imagegen') || enabled('videogen') },
  ].filter(item => item.show)
})
function startEditConnectionName() { editingConnectionName.value = true }
function finishEditConnectionName() { editingConnectionName.value = false }
function onOAuthCatalogChanged() {
  // OAuth login/logout rewrites the server-side catalog; refresh only when the
  // local copy is clean so unsaved provider edits are never overwritten.
  if (!catalogDirty.value) void load()
}
const filteredConnections = computed(() => (catalog.value?.connections || []).map((connection: Record<string, any>, index: number) => ({ connection, index })).filter((row: { connection: Record<string, any>; index: number }) => `${connectionDisplayName(row.connection)} ${row.connection.provider} ${row.connection.binding}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
function modelLabel(model: Model) { return model.name || model.model || model.id }
function taskLabel(kind: string) {
  const text = TASK_TEXT[kind]?.label
  return text ? tr(text.zh, text.en) : kind
}
function taskDetail(kind: string) {
  const text = TASK_TEXT[kind]?.detail
  return text ? tr(text.zh, text.en) : ''
}
function taskGroupLabel(group: string) {
  const text = GROUP_TEXT[group]
  return text ? tr(text.zh, text.en) : group
}
function taskProviderName(row: OptionRow) {
  const ref = row.model.provider_ref || row.profile.provider_ref || (row.profile.connection_id ? { connection_id: row.profile.connection_id } : null)
  if (ref?.connection_id) {
    const connection = (catalog.value?.connections || []).find((item: Record<string, any>) => item.id === ref.connection_id)
    return connection?.name || tr('提供方不可用', 'Provider unavailable')
  }
  if (ref?.service && ref?.profile_id) {
    const profile = (catalog.value?.services?.[ref.service]?.profiles || []).find((item: Profile) => item.id === ref.profile_id)
    return profile?.name || tr('提供方不可用', 'Provider unavailable')
  }
  return row.profile.name || tr('提供方不可用', 'Provider unavailable')
}
function taskChoiceKnown(value: string, fallback: string) {
  return value === fallback || taskOptions.value.some(row => row.key === value)
}
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
    const row = taskOptions.value.find(item => item.key === value)
    if (!row) return
    choice = row.service === 'llm'
      ? { mode: 'reference', selection: { profile_id: row.profile.id, model_id: row.model.id } }
      : { mode: 'profiles', active_profile_id: row.profile.id, active_model_id: row.model.id }
  }
  if (kind) {
    task.overrides ||= {}
    if (choice) task.overrides[kind] = choice
    else delete task.overrides[kind]
    if (!Object.keys(task.overrides).length) delete task.overrides
  } else if (choice) {
    Object.assign(task, choice)
  }
}
async function load() {
  const version = ++loadVersion
  loading.value = true
  error.value = ''
  try {
    const [settings, stored] = await Promise.all([api<any>('/api/settings'), api<any>('/api/settings/draft').catch(() => null)])
    if (version !== loadVersion) return
    const selected = props.pendingCatalog || stored?.draft?.catalog || settings.catalog
    hydrating.value = true
    catalog.value = selected ? copyCatalog(selected) : null
    editable.value = Boolean(settings.catalog)
    taskKinds.value = settings.task_kinds || []
    providerOptions.value = settings.providers || {}
    connectionTargets.value = settings.connection_targets || []
    savedConnectionIds.value = new Set((settings.catalog?.connections || []).map((connection: { id: string }) => connection.id))
    if (!editable.value || !catalog.value) { hydrating.value = false; return }
    catalog.value.services ||= {}
    catalog.value.services[service.value] ||= { active_profile_id: null, active_model_id: null, profiles: [] }
    catalog.value.services[service.value].profiles ||= []
    const config = catalog.value.services[service.value]
    activeProfileId.value = config.active_profile_id || config.profiles[0]?.id || ''
    activeModelId.value = config.active_model_id || config.profiles[0]?.models?.[0]?.id || ''
    applyRouteProvider()
    originalSignature.value = JSON.stringify(settings.catalog)
    hydrating.value = false
  } catch (cause) { if (version === loadVersion) error.value = cause instanceof Error ? cause.message : tr('模型设置加载失败', 'Failed to load model settings') }
  finally { if (version === loadVersion) loading.value = false }
}
onMounted(load)
onUnmounted(() => { loadVersion += 1 })
watch(() => props.revision, () => { void load() })
watch(() => props.pendingCatalog, value => {
  if (!value || JSON.stringify(value) === JSON.stringify(catalog.value)) return
  hydrating.value = true
  catalog.value = copyCatalog(value)
  hydrating.value = false
})
watch(catalog, value => {
  if (!hydrating.value && value && editable.value) emit('catalogChanged', copyCatalog(value))
}, { deep: true, flush: 'sync' })
watch(() => route.query.provider, applyRouteProvider)
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
function openAdding() { adding.value = true; authAdding.value = false; error.value = '' }
function selectConnection(index: number) {
  adding.value = false
  authAdding.value = false
  editingConnectionName.value = false
  activeConnectionIndex.value = index
}
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
function addConnection(option: { value: string; label?: string; service: string; default_api_format?: string }, custom?: { name: string; base_url: string; api_format: string }) {
  if (!catalog.value) return
  if (option.value === 'openai_codex') { authAdding.value = true; return }
  const connections = catalog.value.connections ||= []
  connections.push({
    id: newConnectionId(), name: custom?.name || option.label || option.value,
    provider: option.value, source_service: option.service,
    api_key: '', base_url: custom?.base_url || '', api_version: '',
    api_format: custom?.api_format || option.default_api_format || 'auto',
    ...(custom ? { service_overrides: { llm: { enabled: true, binding: 'custom' } } } : {}),
  })
  activeConnectionIndex.value = connections.length - 1
  adding.value = false
}
function removeConnection(index: number) {
  if (index === activeConnectionIndex.value && (activeConnectionUsage.value > 0 || activeConnectionBinding.value === 'openai_codex')) return
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
  if (activeProfile.value.models.some(model => model.id === id || model.model === id)) { error.value = tr('该模型已存在', 'This model already exists'); return }
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
</script>

<template>
  <section class="model-catalog-settings" :class="{ 'task-models-page': section === 'task-models' }">
    <header v-if="!embedded" class="model-page-header"><h1>{{ serviceName }}</h1><p>{{ pageDescription }}</p></header>
    <p v-if="loading" class="legacy-settings-loading">{{ tr('加载模型目录中…', 'Loading model catalog…') }}</p>
    <p v-else-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="!editable" class="muted">{{ section === 'task-models' ? tr('仅管理员可管理模型。', 'Only administrators can manage models.') : tr('当前部署未返回可编辑的个人模型目录。你可以添加自己的模型，也可以使用管理员分配的模型。', 'This deployment did not return an editable personal model catalog. You can add your own models or use models assigned by an administrator.') }}</p>
    <template v-else-if="catalog">
      <div v-if="section !== 'connections' && section !== 'task-models' && !catalog.connections?.length" class="model-provider-empty"><p>{{ tr('添加模型前，请先添加提供方。', 'Add a provider before adding models.') }}</p><RouterLink to="/settings/connections">{{ tr('前往提供方', 'Go to providers') }}</RouterLink></div>
      <div class="model-workspace" :class="{ 'task-workspace': section === 'task-models', 'connections-workspace': section === 'connections' }">
        <aside v-if="section !== 'task-models'" class="model-workspace-rail">
          <button class="model-add-button" @click="openAdding"><LegacyIcon name="plus" :size="14" />{{ section === 'connections' ? tr('添加提供方', 'Add provider') : tr('添加模型', 'Add model') }}</button>
          <label class="model-rail-search"><LegacyIcon name="search" :size="14" /><input v-model="query" :aria-label="section === 'connections' ? tr('查找提供方', 'Find provider') : tr('搜索模型', 'Search models')" :placeholder="section === 'connections' ? tr('搜索名称', 'Search by name') : tr('搜索模型', 'Search models')"></label>
          <div class="model-rail-list">
            <template v-if="section === 'connections'">
              <button v-for="row in filteredConnections" :key="row.connection.id || row.index" type="button" class="model-rail-card provider-rail-card" :class="{ active: !adding && activeConnectionIndex === row.index }" :aria-pressed="!adding && activeConnectionIndex === row.index" @click="selectConnection(row.index)">
                <span class="provider-rail-title"><ProviderIcon :provider="row.connection.provider" :size="16" /><strong>{{ connectionDisplayName(row.connection) }}</strong></span>
                <span class="provider-rail-meta">{{ connectionUsage(row.connection) }} {{ tr('个模型', 'configured models') }}<template v-if="!savedConnectionIds.has(row.connection.id)"> · {{ tr('未保存', 'Not saved') }}</template></span>
                <span class="provider-rail-tags"><small v-for="tag in connectionServiceTags(row.connection)" :key="tag.en">{{ chinese ? tag.zh : tag.en }}</small></span>
              </button>
            </template>
            <template v-else-if="section !== 'task-models'">
              <button v-for="row in railRows" :key="`${row.profile.id}:${row.model?.id || 'search'}`" class="model-rail-card" :class="{ active: !adding && activeProfileId === row.profile.id && (!row.model || activeModelId === row.model.id) }" @click="selectRail(row)"><span class="model-rail-title"><strong>{{ row.model ? modelLabel(row.model) : row.profile.name || row.profile.id }}</strong><small v-if="serviceConfig.active_profile_id === row.profile.id && (!row.model || serviceConfig.active_model_id === row.model.id)">✓ {{ tr('默认', 'Default') }}</small></span><span>{{ row.profile.name || row.profile.id }}<template v-if="row.model?.model"> · {{ row.model.model }}</template></span><small>{{ serviceName }}</small></button>
            </template>
            <p v-if="section === 'connections' && !filteredConnections.length" class="model-rail-empty">{{ catalog.connections?.length ? tr('没有匹配的提供方。', 'No providers match your search.') : tr('添加首个提供方以开始配置模型。', 'Add your first provider to start configuring models.') }}</p><p v-else-if="section !== 'connections' && section !== 'task-models' && !railRows.length" class="model-rail-empty">{{ profiles.length ? tr('没有匹配的模型。', 'No models match your search.') : tr('尚未配置模型。', 'No models configured yet.') }}</p>
          </div>
        </aside>
        <section class="model-workspace-detail">
          <template v-if="adding">
            <div v-if="section === 'connections' && authAdding" class="model-editor-card"><CodexOAuthCard :pending-efforts="pendingCodexReasoning" :revision="revision" @catalog-changed="adding = false; authAdding = false; onOAuthCatalogChanged()" @reasoning-changed="emit('codexReasoningChanged', $event)" @reasoning-loaded="emit('codexReasoningLoaded', $event)" /><button type="button" @click="authAdding = false">{{ tr('返回提供方列表', 'Back to provider list') }}</button></div>
            <AddProviderPanel v-else-if="section === 'connections'" :options="addableProviders" :language="language" @create="addConnection" @cancel="adding = false" />
            <div v-else class="model-editor-card"><header><h2>{{ tr('添加 Profile', 'Add profile') }}</h2><p>{{ tr('选择提供方并添加首个模型。', 'Choose a provider and add the first model.') }}</p></header><div class="model-form-grid"><label>Profile ID<input v-model="newProfile.id" aria-label="Profile ID" placeholder="Profile ID"></label><label>{{ tr('显示名称', 'Display name') }}<input v-model="newProfile.name" :placeholder="tr('显示名称', 'Display name')" :aria-label="tr('Profile 显示名称', 'Profile display name')"></label><label>{{ tr('提供方', 'Provider') }}<input v-model="newProfile.provider" :placeholder="tr('提供方', 'Provider')" :aria-label="tr('Profile 提供方', 'Profile provider')"></label><label>Base URL<input v-model="newProfile.base_url" placeholder="Base URL" aria-label="Profile Base URL"></label><label>API Key<input v-model="newProfile.api_key" type="password" placeholder="API Key" aria-label="Profile API Key"></label><label v-if="section !== 'search'">{{ tr('首个模型 ID', 'First model ID') }}<input v-model="newProfile.model_id" :placeholder="tr('首个模型 ID', 'First model ID')" :aria-label="tr('首个模型 ID', 'First model ID')"></label></div><div class="model-editor-actions"><button @click="adding = false">{{ tr('取消', 'Cancel') }}</button><button class="primary" @click="addProfile">{{ tr('添加 Profile', 'Add profile') }}</button></div></div>
          </template>
          <template v-else-if="section === 'connections' && activeConnection">
            <CodexOAuthCard v-if="activeConnectionBinding === 'openai_codex'" :pending-efforts="pendingCodexReasoning" :revision="revision" @catalog-changed="onOAuthCatalogChanged" @reasoning-changed="emit('codexReasoningChanged', $event)" @reasoning-loaded="emit('codexReasoningLoaded', $event)" />
            <CodeBuddyAuthCard v-else-if="activeConnectionBinding === 'codebuddy'" @catalog-changed="onOAuthCatalogChanged" />
            <section class="model-editor-card provider-connection-card" :aria-label="tr('提供方设置', 'Provider settings')">
              <header class="provider-connection-header">
                <p>{{ tr('正在配置提供方', 'Configuring provider') }}</p>
                <div class="provider-name-editor">
                  <input v-if="editingConnectionName" :value="activeConnection.name || ''" :aria-label="tr('编辑提供方名称', 'Rename provider')" autofocus @input="activeConnection.name = ($event.target as HTMLInputElement).value" @blur="finishEditConnectionName" @keydown.enter.prevent="finishEditConnectionName" @keydown.esc.prevent="finishEditConnectionName">
                  <h2 v-else>{{ activeConnection.name || tr('未命名提供方', 'Unnamed provider') }}</h2>
                  <button v-if="!editingConnectionName" type="button" :aria-label="tr('编辑提供方名称', 'Rename provider')" :title="tr('编辑提供方名称', 'Rename provider')" @click="startEditConnectionName"><LegacyIcon name="edit" :size="14" /></button>
                </div>
                <p class="provider-connection-kind">{{ providerKindLabel(activeConnection) }}<template v-if="!savedConnectionIds.has(activeConnection.id)"> · {{ tr('未保存', 'Not saved') }}</template></p>
              </header>
              <div v-if="activeConnectionBinding !== 'openai_codex'" class="provider-connection-body">
                <div v-if="activeConnection.provider === 'volcengine_speech'" class="provider-legacy-speech">
                    <label>{{ tr('语音 App ID（仅旧版控制台）', 'Speech App ID (legacy console only)') }}<input :value="activeConnection.app_id || ''" @input="updateActiveConnection('app_id', ($event.target as HTMLInputElement).value)"></label>
                  <p>{{ tr('请使用语音控制台 API Key。旧版控制台需填写 App ID，并把访问令牌填入密钥字段；Ark 密钥是独立的。', 'Use the Speech console API key. For the legacy console, enter App ID and put the access token in the key field. Ark keys are separate.') }}</p>
                </div>
                <div class="provider-credentials-grid">
                  <label>{{ tr('提供方地址', 'Provider URL') }}
                    <input :value="activeConnection.base_url || ''" :placeholder="connectionDefaultBaseUrl || 'https://api.example.com/v1'" :aria-label="tr('提供方地址', 'Provider URL')" @input="updateConnectionBaseUrl">
                  </label>
                  <template v-if="activeProviderOption?.requires_api_key !== false">
                    <label v-for="(_, index) in Array.isArray(activeConnection.api_key) ? activeConnection.api_key : [activeConnection.api_key]" :key="index">
                      {{ activeConnection.provider === 'volcengine_speech' && activeConnection.app_id ? tr('语音访问令牌', 'Speech access token') : tr('API Key', 'API key') }} {{ Array.isArray(activeConnection.api_key) ? Number(index) + 1 : '' }}
                      <input :type="activeConnection.provider === 'volcengine_speech' ? 'text' : 'password'" :value="Array.isArray(activeConnection.api_key) ? activeConnection.api_key[Number(index)] : activeConnection.api_key" @input="updateConnectionApiKey(Number(index), ($event.target as HTMLInputElement).value)">
                    </label>
                  </template>
                </div>
                <p class="provider-url-hint">{{ tr('留空使用厂商默认地址，也可填写中转或私有部署的自定义地址。', 'Leave blank to use the provider default. Enter a custom URL for a gateway or private deployment.') }}</p>
                <ProviderConnectionAdvanced :connection="activeConnection" :language="language" :formats="activeProviderOption?.api_formats" :default-format="activeProviderOption?.default_api_format" @update="updateActiveConnection" />
                <ProviderServices :connection="activeConnection" :providers="providerOptions" :connection-targets="connectionTargets" :language="language" />
                <ProviderModelDiscovery :input="connectionProbeInput" :discovery="activeConnection.discovery" :hints="connectionHints" :language="language" connection-mode @result="activeConnection.discovery = $event" />
              </div>
              <div v-if="activeConnectionBinding !== 'openai_codex'" class="provider-connection-actions">
                <button type="button" class="danger" :disabled="activeConnectionUsage > 0" :title="activeConnectionUsage > 0 ? tr('请先更换或删除使用此提供方的模型。', 'Change or remove the models using this provider first.') : tr('移除提供方', 'Remove provider')" @click="removeConnection(activeConnectionIndex)"><LegacyIcon name="trash" :size="13" />{{ tr('移除提供方', 'Remove provider') }}</button>
              </div>
              <div v-if="activeConnectionBinding !== 'openai_codex'" class="provider-related-links">
                <RouterLink v-for="link in connectionRelatedLinks" :key="link.path" :to="`/settings/${link.path}?provider=${encodeURIComponent(`connection:${activeConnection.id}`)}`"><LegacyIcon name="arrowRight" :size="12" />{{ chinese ? link.zh : link.en }}</RouterLink>
              </div>
            </section></template>
          <template v-else-if="section === 'task-models'">
            <div class="task-models-workspace">
              <section class="task-setting-section">
                <header class="task-setting-section-header">
                  <h2>{{ tr('全局任务模型', 'Global task model') }}</h2>
                  <p>{{ tr('除了下方单独指定过模型的任务，DeepTutor 自己发起的调用都走这个模型。', 'Every call DeepTutor makes on its own runs here unless the task below names its own model.') }}</p>
                </header>
                <div class="task-setting-section-body">
                  <div class="task-setting-row">
                    <div class="task-setting-row-copy">
                      <h3>{{ tr('后台任务模型', 'Background task model') }}</h3>
                      <p>{{ tr('这些调用短小、频繁，也不会作为答案呈现给学习者，通常选一个更小更便宜的模型就够了。', 'A smaller, cheaper model is usually the right choice: these calls are short, frequent, and never the answer a learner is reading.') }}</p>
                    </div>
                    <div class="task-setting-row-control">
                      <select class="task-model-select" :value="taskChoiceKnown(globalTaskValue, 'inherit') ? globalTaskValue : 'inherit'" :aria-label="tr('后台任务模型', 'Background task model')" :disabled="applying" @change="setTaskChoice(($event.target as HTMLSelectElement).value)">
                        <option value="inherit">{{ tr('跟随对话模型', 'Follow the chat model') }}</option>
                        <option v-if="!taskChoiceKnown(globalTaskValue, 'inherit')" :value="globalTaskValue" disabled>{{ tr('所选模型已不可用，请重新选择', 'Selected model is unavailable — choose another') }}</option>
                        <option v-for="row in taskOptions" :key="row.key" :value="row.key">{{ modelLabel(row.model) }} · {{ taskProviderName(row) }}</option>
                      </select>
                    </div>
                  </div>
                  <p v-if="!taskOptions.length" class="task-models-empty">{{ tr('尚未配置模型。', 'No models configured yet.') }} <RouterLink to="/settings/llm">{{ tr('去添加语言模型', 'Add a language model') }}</RouterLink></p>
                </div>
              </section>
              <section v-for="entry in taskGroups" :key="entry.group" class="task-setting-section">
                <header class="task-setting-section-header"><h2>{{ taskGroupLabel(entry.group) }}</h2></header>
                <div class="task-setting-section-body">
                  <div v-for="kind in entry.kinds" :key="kind" class="task-setting-row">
                    <div class="task-setting-row-copy">
                      <h3>{{ taskLabel(kind) }}</h3>
                      <p v-if="taskDetail(kind)">{{ taskDetail(kind) }}</p>
                    </div>
                    <div class="task-setting-row-control">
                      <select class="task-model-select" :value="taskChoiceKnown(overrideValue(kind), 'global') ? overrideValue(kind) : 'global'" :aria-label="taskLabel(kind)" :disabled="applying" @change="setTaskChoice(($event.target as HTMLSelectElement).value, kind)">
                        <option value="global">{{ tr('跟随全局任务模型', 'Follow the global task model') }}</option>
                        <option v-if="!taskChoiceKnown(overrideValue(kind), 'global')" :value="overrideValue(kind)" disabled>{{ tr('所选模型已不可用，请重新选择', 'Selected model is unavailable — choose another') }}</option>
                        <option v-for="row in taskOptions" :key="row.key" :value="row.key">{{ modelLabel(row.model) }} · {{ taskProviderName(row) }}</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </template>
          <template v-else-if="activeProfile"><EmbeddingModelUsage v-if="section === 'embedding' && activeModel" :profile-id="activeProfile.id" :model-id="activeModel.id" :language="language" /><div class="model-editor-card model-editor"><header><p>{{ tr('正在配置模型', 'Configuring model') }}</p><h2>{{ activeProfile.name || activeProfile.id }}</h2><span>{{ activeProfile.provider || activeProfile.binding }}</span></header><div class="model-form-grid"><label>{{ tr('名称', 'Name') }}<input v-model="activeProfile.name"></label><label>{{ tr('提供方', 'Provider') }}<input v-model="activeProfile.provider"></label><label>{{ tr('绑定标识', 'Binding') }}<input v-model="activeProfile.binding" placeholder="openai"></label><label>Base URL<input v-model="activeProfile.base_url"></label><label>API Key<input v-model="activeProfile.api_key" type="password"></label><label>{{ tr('API 版本', 'API version') }}<input v-model="activeProfile.api_version"></label></div><div class="model-editor-actions"><button class="danger" :disabled="profiles.length <= 1" @click="removeProfile">{{ tr('删除当前 Profile', 'Delete current profile') }}</button></div></div>
            <div v-if="section !== 'search'" class="model-editor-card"><header><h2>{{ tr('当前 Profile 的模型', 'Models in this profile') }}</h2><p>{{ tr('编辑模型 ID，或将其他模型添加到此 Profile。', 'Edit model IDs or add other models to this profile.') }}</p></header><div class="model-add-inline"><input v-model="newModelId" :aria-label="tr('新模型 ID', 'New model ID')" :placeholder="tr('新模型 ID', 'New model ID')"><button @click="addModel">{{ tr('添加模型', 'Add model') }}</button></div><div class="model-list"><div v-for="model in models" :key="model.id" :class="{ active: activeModelId === model.id }"><button class="model-select" @click="activeModelId = model.id; syncSelection()"><strong>{{ modelLabel(model) }}</strong><small>{{ model.model }}</small></button><button class="danger" :disabled="models.length <= 1" @click="removeModel(model)">{{ tr('删除', 'Delete') }}</button></div></div></div>
            <div v-if="activeProfile && section !== 'task-models' && section !== 'search'" class="model-editor-card model-discovery-card">
              <header><h2>{{ tr('从提供方发现模型', 'Discover models from provider') }}</h2><span>{{ tr('使用当前 Profile 的地址与凭据拉取可用模型', 'Fetch available models using this profile’s endpoint and credentials') }}</span></header>
              <div class="model-discovery-body">
                <ProviderModelDiscovery :language="language" :key="`${activeProfile.id}:${probeInput.base_url}`" :input="probeInput" pick-many
                                        :selected-models="models.map(item => item.model || item.id)"
                                        @pick="pickDiscoveredModel" @pick-many="addDiscoveredModels" />
              </div>
            </div>
            <div v-if="activeProfile && activeModel && section !== 'task-models' && section !== 'search'" class="model-editor-card model-fields-card">
              <header><h2>{{ tr('模型参数', 'Model parameters') }}</h2><span>{{ modelLabel(activeModel) }} · {{ activeModel.model || activeModel.id }}</span></header>
              <div class="model-fields-body">
                <ModelFieldsEditor :service="service" :profile="activeProfile" :model="activeModel" :binding="activeProfile.binding || activeProfile.provider" :language="language" />
              </div>
            </div>
            <ModelTestPanel v-if="activeProfile && section !== 'task-models'" :catalog="catalog" :service="service" :profile="activeProfile" :model="section === 'search' ? null : models.find(model => model.id === activeModelId) || models[0]" :language="language" @adopt="adoptDetected" />
            <ServicePreviewPanel v-if="activeProfile && previewService" :service="previewService" :profile-id="activeProfile.id" :model-id="(section === 'search' ? null : models.find(model => model.id === activeModelId) || models[0])?.id" :catalog="catalog" />
            <div v-if="activeProfile && activeModel && section === 'tts'" class="model-editor-card voice-discovery-card">
              <div class="model-fields-body">
                <VoiceDiscoveryField :catalog="catalog" :profile-id="activeProfile.id" :model-id="activeModel.id" :model-value="String(activeModel.voice ?? '')" :disabled="activeManaged" @update:model-value="setVoice" />
              </div>
            </div>
            <VoicePreviewPanel v-if="activeProfile && section === 'tts'" :profile-id="activeProfile.id" :model-id="(models.find(model => model.id === activeModelId) || models[0])?.id" :catalog="catalog" :model="(models.find(model => model.id === activeModelId) || models[0]) as Record<string, unknown> | undefined" />
          </template>
          <div v-else class="model-detail-empty"><LegacyIcon name="settings" :size="20" /><h2>{{ tr('尚未选择', 'Nothing selected') }}</h2><p>{{ tr('选择一个模型，查看并编辑参数、测试连接。', 'Choose a model to review its parameters and test the connection.') }}</p></div>
        </section>
      </div>
    </template>
  </section>
</template>
