<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, authStatus, post } from '../api'
import EngineConfigForm from '../components/EngineConfigForm.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import KnowledgeEngineIcon from '../components/KnowledgeEngineIcon.vue'
import KbLinkedFolders from '../components/KbLinkedFolders.vue'
import KbFilesWorkspace from '../components/KbFilesWorkspace.vue'
import KbSources from '../components/KbSources.vue'
import KbVersions from '../components/KbVersions.vue'
import KbSettings from '../components/KbSettings.vue'
import KbKiwixArticles from '../components/KbKiwixArticles.vue'
import KbDevices from '../components/KbDevices.vue'

import { scopedUrl } from '../workspaceScope'

interface KnowledgeBase { name: string; id?: string; is_default?: boolean; status?: string; source?: string; read_only?: boolean; assigned?: boolean; statistics?: Record<string, unknown>; metadata?: Record<string, unknown> }
interface KnowledgeFile { name: string; type: 'file' | 'folder'; size?: number; mime_type?: string }
interface Progress { task_id?: string; stage?: string; status?: string; percent?: number; message?: string; error?: string }
interface Provider { id: string; name: string; description: string; configured?: boolean; readiness_reason?: string; requires_api_key?: boolean; modes?: string[]; default_mode?: string }
interface EmbeddingOption { profile_id: string; profile_name: string; model_id: string; label: string; detail?: string }
interface EmbeddingResponse { embedding?: { active?: { profile_id: string; model_id: string } | null; options?: EmbeddingOption[] } }
type EngineConfig = Record<string, unknown>
const route = useRoute()
const router = useRouter()
const bases = ref<KnowledgeBase[]>([])
const detail = ref<KnowledgeBase | null>(null)
const files = ref<KnowledgeFile[]>([])
const newName = ref('')
const selectedFiles = ref<File[]>([])
const destSubdir = ref('')
const fileQuery = ref('')
const baseQuery = ref('')
const progress = ref<Progress | null>(null)
const preview = ref<{ name: string; text: string } | null>(null)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const loading = ref(true)
const homeSection = ref<'knowledge-bases' | 'knowledge-engines'>('knowledge-bases')
const createOpen = ref(false)
const createMode = ref<'new' | 'link'>('new')
const createProvider = ref('llamaindex')
const createRetrievalMode = ref('')
const embeddingOptions = ref<EmbeddingOption[]>([])
const embeddingSelection = ref('')
const embeddingLoading = ref(false)
const embeddingError = ref('')
const engineDefaultSummary = ref<string[]>([])
let createMetadataRevision = 0
const linkFolder = ref('')
const detailSection = ref<'files' | 'add' | 'folders' | 'github' | 'web' | 'versions' | 'devices' | 'kiwix' | 'settings'>('files')
const sourcePreset = ref<'obsidian' | 'marginnote4' | 'kiwix' | null>(null)
const sourcePath = ref('')
const sourceDescription = ref('')
const serverUrl = ref('')
const zimName = ref('')
const catalogQuery = ref('')
const archives = ref<{ zim_name: string; title: string }[]>([])
const verifiedTitle = ref('')
const providers = ref<Provider[]>([])
const selectedProvider = ref('')
const providerConfig = ref<Record<string, any>>({})
const providerMode = ref('')
const preflight = ref<{ key: string; label: string; ok: boolean; detail?: string; optional?: boolean }[]>([])
const isAdmin = ref(false)
let pollTimer: ReturnType<typeof setInterval> | undefined
const name = () => String(route.params.kbName ?? '')
const createProviders = computed(() => providers.value.filter(provider => provider.id !== 'ima'))
const activeCreateProvider = computed(() => providers.value.find(provider => provider.id === createProvider.value) || null)
const createNeedsEmbedding = computed(() => ['llamaindex', 'lightrag', 'graphrag'].includes(createProvider.value))
const createSubmitDisabled = computed(() => busy.value || !newName.value.trim() || (createMode.value === 'link' && !linkFolder.value.trim()) || (createMode.value === 'new' && (!activeCreateProvider.value || providerStatus(activeCreateProvider.value).label !== '可用' || (createNeedsEmbedding.value && (embeddingLoading.value || Boolean(embeddingError.value) || !embeddingSelection.value)))))
const filteredBases = computed(() => bases.value.filter(base => base.name.toLowerCase().includes(baseQuery.value.trim().toLowerCase())))
const filteredFiles = computed(() => files.value.filter(file => file.name.toLowerCase().includes(fileQuery.value.trim().toLowerCase())))
const kbCountByProvider = computed<Record<string, number>>(() => Object.fromEntries(providers.value.map(provider => [provider.id, bases.value.filter(base => kbProvider(base) === provider.id).length])))
const isMarginNote = computed(() => detail.value?.metadata?.type === 'marginnote4')
const isKiwix = computed(() => detail.value?.metadata?.type === 'kiwix')
const detailSections = computed(() => isMarginNote.value ? ['devices', 'settings'] as const : isKiwix.value ? ['kiwix', 'settings'] as const : ['files', 'add', 'folders', 'github', 'web', 'versions', 'settings'] as const)
const activeDetailSection = computed(() => (detailSections.value as readonly string[]).includes(detailSection.value) ? detailSection.value : detailSections.value[0])
const indexVersions = computed(() => (detail.value?.statistics?.index_versions || []) as { version?: string; signature?: string; state?: string; model?: string; dimension?: number; created_at?: string; ready?: boolean; legacy?: boolean; failure_summary?: string }[])
const running = computed(() => Boolean(progress.value && !['completed', 'error', 'failed', 'cancelled', 'not_started'].includes(progress.value.stage || progress.value.status || '')))
const progressPercent = computed(() => Math.max(0, Math.min(100, Math.round(progress.value?.percent ?? (running.value ? 0 : 100)))))
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(scopedUrl(path), { credentials: 'include', ...init })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `HTTP ${response.status}`)
  return result as T
}
async function loadProviders() {
  try { providers.value = (await api<{ providers?: Provider[] }>('/api/knowledge-bases/rag-providers')).providers ?? []; if (!providers.value.some(item => item.id === createProvider.value) && providers.value[0]) createProvider.value = providers.value[0].id } catch { providers.value = [] }
}
async function loadEngine(id: string) {
  if (!id) return
  try {
    const [config, checks, auth] = await Promise.all([api<Record<string, any>>(`/api/knowledge-bases/rag-pipelines/${encodeURIComponent(id)}/config`), api<{ checks: typeof preflight.value }>(`/api/knowledge-bases/rag-pipelines/${encodeURIComponent(id)}/preflight`), authStatus()])
    providerConfig.value = config
    preflight.value = checks.checks || []
    isAdmin.value = Boolean(auth.is_admin)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '引擎配置加载失败' }
}
async function load() {
  error.value = ''
  void loadProviders()
  loading.value = true
  try {
    bases.value = await api<KnowledgeBase[]>('/api/knowledge-bases/list')
    if (name()) {
      const key = encodeURIComponent(name())
      ;[detail.value, { files: files.value }] = await Promise.all([api<KnowledgeBase>(`/api/knowledge-bases/${key}`), api<{ files: KnowledgeFile[] }>(`/api/knowledge-bases/${key}/files`)])
      await checkProgress()
    } else { detail.value = null; files.value = []; progress.value = null }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '知识库加载失败' }
  finally { loading.value = false }
}
watch(name, () => { if (pollTimer) clearInterval(pollTimer); preview.value = null; detailSection.value = 'files'; void load() }, { immediate: true })
watch(() => route.query?.engine, id => { if (id) { homeSection.value = 'knowledge-engines'; selectedProvider.value = String(id); providerMode.value = providers.value.find(item => item.id === id)?.default_mode || ''; void loadEngine(String(id)) } else if (homeSection.value === 'knowledge-engines' && !route.query.section) homeSection.value = 'knowledge-bases' }, { immediate: true })
watch(() => route.query?.section, value => { if (value === 'engines') { homeSection.value = 'knowledge-engines'; selectedProvider.value = '' } })
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })

function detailLabel(key: string) { return ({ files: '文件', add: '添加文档', folders: '关联文件夹', github: 'GitHub', web: '网页', versions: '索引版本', devices: '设备', kiwix: '文章', settings: '设置' } as Record<string, string>)[key] }
function detailIcon(key: string) { return ({ files: 'document', add: 'plus', folders: 'folder', github: 'resources', web: 'network', versions: 'resources', devices: 'agents', kiwix: 'document', settings: 'settings' } as Record<string, string>)[key] }
function formatFileSize(bytes: number) { if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`; if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${bytes} B` }
function selectHomeSection(section: 'knowledge-bases' | 'knowledge-engines') {
  homeSection.value = section
  selectedProvider.value = ''
  void router.push({ path: '/knowledge-bases', query: section === 'knowledge-engines' ? { section: 'engines' } : {} })
}
function openCreate() { sourcePreset.value = null; createMode.value = 'new'; createProvider.value = providers.value.some(item => item.id === 'llamaindex') ? 'llamaindex' : providers.value[0]?.id || 'llamaindex'; createRetrievalMode.value = ''; linkFolder.value = ''; newName.value = ''; selectedFiles.value = []; createOpen.value = true; void loadCreateMetadata() }
function configNumber(config: EngineConfig, key: string, fallback = '') { const value = config[key]; return typeof value === 'number' || typeof value === 'string' ? String(value) : fallback }
async function loadCreateMetadata() {
  if (!createOpen.value || createMode.value !== 'new') return
  const revision = ++createMetadataRevision
  const provider = createProvider.value
  engineDefaultSummary.value = []
  embeddingError.value = ''
  if (createNeedsEmbedding.value) {
    embeddingLoading.value = true
    try {
      const data = await api<EmbeddingResponse>('/api/knowledge-bases/rag-pipelines/model-options?kinds=embedding')
      if (revision !== createMetadataRevision) return
      embeddingOptions.value = data.embedding?.options || []
      const active = data.embedding?.active
      const selected = (active && embeddingOptions.value.find(option => option.profile_id === active.profile_id && option.model_id === active.model_id)) || embeddingOptions.value[0]
      embeddingSelection.value = selected ? JSON.stringify([selected.profile_id, selected.model_id]) : ''
    } catch (cause) {
      if (revision === createMetadataRevision) { embeddingOptions.value = []; embeddingSelection.value = ''; embeddingError.value = cause instanceof Error ? cause.message : '嵌入模型加载失败' }
    } finally {
      if (revision === createMetadataRevision) embeddingLoading.value = false
    }
  } else {
    embeddingLoading.value = false
    embeddingOptions.value = []
    embeddingSelection.value = ''
  }
  try {
    let config: EngineConfig | null = null
    if (provider === 'llamaindex') config = await api<EngineConfig>('/api/knowledge-bases/rag-pipelines/llamaindex/config')
    else if (provider === 'graphrag') config = await api<EngineConfig>('/api/knowledge-bases/rag-pipelines/graphrag/config')
    else if (provider === 'lightrag') config = await api<EngineConfig>('/api/knowledge-bases/rag-pipelines/lightrag/config')
    else if (provider === 'pageindex') config = await api<EngineConfig>('/api/knowledge-bases/rag-pipelines/pageindex/config')
    else if (provider === 'lightrag-server') config = await api<EngineConfig>('/api/knowledge-bases/rag-pipelines/lightrag-server/config')
    if (revision !== createMetadataRevision) return
    if (provider === 'llamaindex' && config) engineDefaultSummary.value = [`检索画像: ${configNumber(config, 'retrieval_profile')}`, `每次查询结果数: ${configNumber(config, 'top_k')}`, `分块大小: ${configNumber(config, 'chunk_size')} / 分块重叠: ${configNumber(config, 'chunk_overlap')}`]
    else if (provider === 'graphrag' && config) engineDefaultSummary.value = [`回答风格: ${configNumber(config, 'response_type')}`, `社区层级: ${configNumber(config, 'community_level')}`]
    else if (provider === 'lightrag' && config) engineDefaultSummary.value = [`每次查询结果数: ${configNumber(config, 'top_k')}`, `并行文件数: ${configNumber(config, 'max_concurrent_files')}`, `额外抽取轮次: ${configNumber(config, 'entity_extract_max_gleaning')}`]
    else if (provider === 'pageindex' && config) engineDefaultSummary.value = [config.configured ? 'API 密钥已配置' : 'API 密钥未配置']
    else if (provider === 'lightrag-server' && config) engineDefaultSummary.value = [String(config.server_url || '没有默认服务器地址'), config.api_key_set ? 'API 密钥已配置' : '没有 API 密钥']
    else if (provider === 'pageindex-oss') engineDefaultSummary.value = ['使用全局当前对话模型']
  } catch {
    if (revision === createMetadataRevision) engineDefaultSummary.value = []
  }
}
watch(createProvider, () => { createRetrievalMode.value = ''; void loadCreateMetadata() })
watch([createOpen, createMode], () => { void loadCreateMetadata() })
function kbProvider(base: KnowledgeBase) { return String(base.statistics?.rag_provider || base.metadata?.rag_provider || base.metadata?.type || 'llamaindex') }
function kbDocCount(base: KnowledgeBase) { const value = base.statistics?.raw_documents ?? base.metadata?.last_indexed_count; return typeof value === 'number' ? value : null }
function providerName(id: string) { return providers.value.find(provider => provider.id === id)?.name || (id ? id.charAt(0).toUpperCase() + id.slice(1) : id) }
function kbStatusClass(base: KnowledgeBase) { const status = base.status || base.statistics?.status; return status === 'ready' ? 'ready' : status === 'error' ? 'error' : 'pending' }
function providerStatus(provider: Provider) { if (provider.requires_api_key && provider.configured === false) return { label: '需配置密钥', tone: 'warning' }; if (provider.configured === false) return { label: '未安装', tone: 'neutral' }; return { label: '可用', tone: 'ready' } }
const providerGroups = computed(() => [
  { key: 'local', label: '本地引擎', description: '在此设备上建立索引并检索。', icon: '▣', items: providers.value.filter(provider => ['llamaindex', 'pageindex-oss', 'graphrag', 'lightrag'].includes(provider.id) || (!provider.requires_api_key && !['lightrag-server', 'pageindex', 'ima'].includes(provider.id))) },
  { key: 'server', label: '服务器引擎', description: '连接你自行运行的检索服务器。', icon: '▦', items: providers.value.filter(provider => provider.id === 'lightrag-server') },
  { key: 'cloud', label: '云服务', description: '通过账号凭据连接托管提供方。', icon: '☁', items: providers.value.filter(provider => ['pageindex', 'ima'].includes(provider.id) || (provider.requires_api_key && provider.id !== 'lightrag-server')) },
])
const externalSources = computed<{ id: 'obsidian' | 'marginnote4' | 'kiwix'; name: string; description: string; action: string; count: number }[]>(() => [
  { id: 'obsidian', name: 'Obsidian', description: '实时 Obsidian 仓库，直接浏览和编辑，无需索引。', action: '连接仓库', count: bases.value.filter(base => base.metadata?.type === 'obsidian').length },
  { id: 'marginnote4', name: 'MarginNote 4', description: '由 MarginNote 4 插件推送的笔记、摘录和卡片。', action: '连接资料库', count: bases.value.filter(base => base.metadata?.type === 'marginnote4').length },
  { id: 'kiwix', name: 'Kiwix / ZIM', description: '通过 kiwix-serve 搜索现有 ZIM 档案，文章保留在服务器上。', action: '连接档案', count: bases.value.filter(base => base.metadata?.type === 'kiwix').length },
])
function openSource(source: 'obsidian' | 'marginnote4' | 'kiwix') { sourcePreset.value = source; newName.value = ''; sourcePath.value = ''; sourceDescription.value = ''; serverUrl.value = ''; zimName.value = ''; archives.value = []; verifiedTitle.value = ''; createOpen.value = true }
async function browseArchives() { if (!serverUrl.value.trim()) return; busy.value = true; error.value = ''; try { archives.value = (await api<{ archives: typeof archives.value }>(`/api/knowledge-bases/kiwix-catalog?server_url=${encodeURIComponent(serverUrl.value.trim())}&q=${encodeURIComponent(catalogQuery.value.trim())}`)).archives } catch (cause) { error.value = cause instanceof Error ? cause.message : '档案浏览失败' } finally { busy.value = false } }
async function probeArchive() { if (!serverUrl.value.trim() || !zimName.value.trim()) return; busy.value = true; error.value = ''; verifiedTitle.value = ''; try { verifiedTitle.value = (await post<{ title: string }>('/api/knowledge-bases/probe-kiwix', { server_url: serverUrl.value.trim(), zim_name: zimName.value.trim() })).title } catch (cause) { error.value = cause instanceof Error ? cause.message : '连接检查失败' } finally { busy.value = false } }
async function connectSource() {
  if (!sourcePreset.value || !newName.value.trim()) return
  busy.value = true; error.value = ''
  try {
    if (sourcePreset.value === 'obsidian') await post('/api/knowledge-bases/connect-obsidian', { name: newName.value.trim(), vault_path: sourcePath.value.trim() })
    else if (sourcePreset.value === 'marginnote4') await post('/api/knowledge-bases/connect-marginnote4', { name: newName.value.trim(), description: sourceDescription.value })
    else await post('/api/knowledge-bases/connect-kiwix', { name: newName.value.trim(), server_url: serverUrl.value.trim(), zim_name: zimName.value.trim() })
    const createdName = `account:kb:${newName.value.trim()}`
    createOpen.value = false
    newName.value = ''
    await router.push(`/knowledge-bases/${encodeURIComponent(createdName)}`)
    notice.value = '知识来源已连接'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '连接失败' }
  finally { busy.value = false }
}
function openEngine(id: string) { selectedProvider.value = id; providerMode.value = providers.value.find(item => item.id === id)?.default_mode || ''; void router.push({ path: '/knowledge-bases', query: { engine: id } }) }
async function saveEngine() {
  if (!selectedProvider.value || !isAdmin.value) return
  busy.value = true
  try {
    if (providerMode.value) await api(`/api/knowledge-bases/rag-providers/${encodeURIComponent(selectedProvider.value)}/mode`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: providerMode.value }) })
    providerConfig.value = await api(`/api/knowledge-bases/rag-pipelines/${encodeURIComponent(selectedProvider.value)}/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(providerConfig.value) })
    notice.value = '引擎配置已保存'
    await loadProviders()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存引擎配置失败' }
  finally { busy.value = false }
}
async function checkProgress() {
  if (!name()) return
  try {
    progress.value = await api<Progress>(`/api/knowledge-bases/${encodeURIComponent(name())}/progress`)
    if (running.value && !pollTimer) pollTimer = setInterval(checkProgress, 1500)
    if (!running.value && pollTimer) { clearInterval(pollTimer); pollTimer = undefined; await load() }
  } catch { if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined } }
}
function startTask(result: Progress) {
  progress.value = result
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(checkProgress, 1500)
}
async function create() {
  if (sourcePreset.value) return connectSource()
  if (!newName.value.trim()) return
  if (createMode.value === 'link') {
    if (!linkFolder.value.trim()) return
    busy.value = true; error.value = ''
    try {
      const result = await post<{ name?: string }>('/api/knowledge-bases/connect-folder', { name: newName.value.trim(), folder_path: linkFolder.value.trim(), rag_provider: createProvider.value })
      const createdName = result.name || `account:kb:${newName.value.trim()}`
      createOpen.value = false
      await router.push(`/knowledge-bases/${encodeURIComponent(createdName)}`)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '关联失败' }
    finally { busy.value = false }
    return
  }
  busy.value = true
  error.value = ''
  const form = new FormData()
  form.append('name', newName.value.trim())
  form.append('rag_provider', createProvider.value)
  if (createRetrievalMode.value) form.append('search_mode', createRetrievalMode.value)
  if (createNeedsEmbedding.value && embeddingSelection.value) form.append('embedding_model', embeddingSelection.value)
  for (const file of selectedFiles.value) { form.append('files', file); if (file.webkitRelativePath) form.append('rel_paths', file.webkitRelativePath) }
  try {
    const result = await request<Progress & { name?: string }>('/api/knowledge-bases', { method: 'POST', body: form })
    const createdName = result.name || newName.value.trim()
    createOpen.value = false
    newName.value = ''
    selectedFiles.value = []
    await router.push(`/knowledge-bases/${encodeURIComponent(createdName)}`)
    startTask(result)
    notice.value = '知识库已创建，正在处理文件'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败' }
  finally { busy.value = false }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !detail.value) return
  const form = new FormData()
  for (const file of input.files) { form.append('files', file); if (file.webkitRelativePath) form.append('rel_paths', file.webkitRelativePath) }
  if (destSubdir.value.trim()) form.append('dest_subdir', destSubdir.value.trim())
  busy.value = true
  error.value = ''
  try {
    const result = await request<Progress>(`/api/knowledge-bases/${encodeURIComponent(detail.value.name)}/upload`, { method: 'POST', body: form })
    startTask(result)
    notice.value = '文件已上传，正在建立索引'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '上传失败' }
  finally { busy.value = false; input.value = '' }
}
async function removeFile(file: KnowledgeFile) {
  if (!detail.value || !confirm(`删除“${file.name}”？`)) return
  busy.value = true
  try { await api(`/api/knowledge-bases/${encodeURIComponent(detail.value.name)}/files/${file.name.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }); await load(); notice.value = '文件已删除，可能需要重新索引' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busy.value = false }
}
async function setDefault() {
  if (!detail.value) return
  busy.value = true
  try { await api(`/api/knowledge-bases/default/${encodeURIComponent(detail.value.name)}`, { method: 'PUT' }); await load(); notice.value = '已设为默认知识库' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '设置默认库失败' }
  finally { busy.value = false }
}
async function removeBase() {
  if (!detail.value || !confirm(`删除知识库“${detail.value.name}”及其索引？此操作无法撤销。`)) return
  busy.value = true
  try { await post('/api/knowledge-bases/delete', { name: detail.value.name }); await router.push('/knowledge-bases') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除知识库失败' }
  finally { busy.value = false }
}
async function rebuild(retry = false) {
  if (!detail.value) return
  busy.value = true
  try { const result = await post<Progress>(`/api/knowledge-bases/${encodeURIComponent(detail.value.name)}/${retry ? 'retry' : 'reindex'}`, {}); startTask(result); notice.value = retry ? '正在重试索引' : '正在重新索引' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '索引操作失败' }
  finally { busy.value = false }
}
async function showPreview(file: KnowledgeFile) {
  if (!detail.value) return
  try { const result = await api<{ text?: string; content?: string }>(`/api/knowledge-bases/${encodeURIComponent(detail.value.name)}/file-preview-text/${file.name.split('/').map(encodeURIComponent).join('/')}`); preview.value = { name: file.name, text: result.text || result.content || '暂无可预览文本' } }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '预览失败' }
}
</script>

<template>
  <main class="feature-page knowledge-page">
    <template v-if="!detail">
      <header class="knowledge-home-bar"><span class="dt-crumb is-feature"><LegacyIcon name="database" :size="15" />知识中心</span><button class="primary" aria-label="新建知识库" @click="openCreate"><LegacyIcon name="plus" :size="14" />新建知识库</button></header>
      <div class="knowledge-home-tabs" role="tablist" aria-label="知识中心"><button role="tab" :aria-selected="homeSection === 'knowledge-bases'" :class="{ active: homeSection === 'knowledge-bases' }" @click="selectHomeSection('knowledge-bases')"><span><LegacyIcon name="database" :size="15" />知识库 <small>{{ bases.length }}</small></span></button><button role="tab" :aria-selected="homeSection === 'knowledge-engines'" :class="{ active: homeSection === 'knowledge-engines' }" @click="selectHomeSection('knowledge-engines')"><span><LegacyIcon name="model" :size="15" />知识引擎 <small>{{ providers.length + 3 }}</small></span></button></div>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <template v-if="!detail && homeSection === 'knowledge-engines' && !selectedProvider"><div class="knowledge-engine-groups"><section v-for="group in providerGroups" :key="group.key"><header><span>{{ group.icon }}</span><div><h2>{{ group.label }}</h2><p>{{ group.description }}</p></div></header><div class="knowledge-home-grid"><button v-for="provider in group.items" :key="provider.id" class="knowledge-engine-card" @click="openEngine(provider.id)"><div><span class="knowledge-engine-icon"><KnowledgeEngineIcon :engine="provider.id" :size="22" /></span><strong>{{ provider.name }}</strong><small :class="['knowledge-status-badge', providerStatus(provider).tone]">{{ providerStatus(provider).label }}</small></div><p>{{ provider.description }}</p><footer><span v-if="provider.default_mode" class="knowledge-provider-mode">{{ provider.default_mode }}</span><span v-if="kbCountByProvider[provider.id]">{{ kbCountByProvider[provider.id] }} 个知识库</span><span>›</span></footer></button></div></section><section><header><span>▤</span><div><h2>外部知识来源</h2><p>连接实时资料库和笔记应用，无需重新建立索引。</p></div></header><div class="knowledge-home-grid"><button v-for="source in externalSources" :key="source.id" class="knowledge-engine-card" @click="openSource(source.id)"><div><span class="knowledge-engine-icon"><KnowledgeEngineIcon :engine="source.id" :size="22" /></span><strong>{{ source.name }}</strong></div><p>{{ source.description }}</p><footer><span>{{ source.action }}</span><span v-if="source.count">{{ source.count }} 个已连接</span><span>›</span></footer></button></div></section></div></template>
    <template v-else-if="!detail && homeSection === 'knowledge-bases'"><section class="knowledge-home-list"><header><h2><LegacyIcon name="database" :size="14" />知识库 <small>{{ bases.length }}</small></h2><div v-if="bases.length > 6" class="knowledge-base-search"><input v-model="baseQuery" type="search" aria-label="搜索知识库" placeholder="搜索知识库…"></div></header><div v-if="!bases.length" class="knowledge-home-empty"><LegacyIcon name="database" :size="24" /><h3>暂无知识库</h3><p>创建一个知识库，上传文档，在对话中检索有依据的内容。</p><button class="primary" aria-label="新建知识库" @click="openCreate"><LegacyIcon name="plus" :size="14" />新建知识库</button></div><div v-else-if="!filteredBases.length" class="knowledge-home-empty compact">没有匹配项</div><div v-else class="knowledge-home-grid"><button v-for="base in filteredBases" :key="base.id || base.name" class="knowledge-base-card" @click="router.push(`/knowledge-bases/${encodeURIComponent(base.id || base.name)}`)"><span class="knowledge-base-icon"><KnowledgeEngineIcon :engine="kbProvider(base)" :size="27" /></span><div><div class="knowledge-base-title"><i :class="kbStatusClass(base)"/><strong>{{ base.name }}</strong><span v-if="base.is_default" title="默认知识库">★</span></div><p v-if="base.assigned">共享给你</p><footer><span>{{ providerName(kbProvider(base)) }}</span><span v-if="kbDocCount(base) !== null">{{ kbDocCount(base) }} 篇文档</span></footer></div></button></div></section></template>
    <section v-else-if="!detail && selectedProvider" class="knowledge-engine-detail"><button class="text-button" @click="selectedProvider = ''; router.push({ path: '/knowledge-bases', query: { section: 'engines' } })">← 全部引擎</button><h2>{{ providers.find(item => item.id === selectedProvider)?.name || selectedProvider }}</h2><p>{{ providers.find(item => item.id === selectedProvider)?.description }}</p><div class="engine-preflight"><div v-for="check in preflight" :key="check.key" :class="check.ok ? 'ok' : 'bad'">{{ check.ok ? '✓' : '×' }} {{ check.label }}<small v-if="check.detail"> · {{ check.detail }}</small></div></div><label v-if="providers.find(item => item.id === selectedProvider)?.modes?.length">检索模式<select v-model="providerMode"><option v-for="mode in providers.find(item => item.id === selectedProvider)?.modes" :key="mode" :value="mode">{{ mode }}</option></select></label><EngineConfigForm v-model="providerConfig" /><p v-if="!isAdmin" class="muted">只有管理员可以修改共享引擎配置。</p><button v-if="isAdmin" class="primary" :disabled="busy" @click="saveEngine">保存引擎配置</button></section>
    <section v-else-if="detail" class="knowledge-detail-content">
      <header class="kb-detail-header"><div class="kb-detail-title"><span class="kb-detail-icon"><KnowledgeEngineIcon :engine="kbProvider(detail)" :size="30" /></span><div><button class="kb-detail-back" @click="router.push('/knowledge-bases')"><LegacyIcon name="chevronLeft" :size="14" />知识库</button><div class="kb-detail-name"><h1>{{ detail.name }}</h1><span v-if="detail.is_default" class="kb-default-badge">★ 默认</span><span v-if="detail.assigned" class="kb-assigned-badge">共享给你</span><span :class="['kb-status-badge', kbStatusClass(detail)]">{{ detail.status || '未知' }}</span></div><p>{{ providerName(kbProvider(detail)) }}<template v-if="detail.metadata?.embedding_model"> · {{ detail.metadata.embedding_model }}<template v-if="detail.metadata.embedding_dim"> · {{ detail.metadata.embedding_dim }}d</template></template> · 更新于 {{ detail.metadata?.last_updated || '时间未知' }}<template v-if="detail.metadata?.last_indexed_at"> · 最近索引 {{ detail.metadata.last_indexed_at }}</template></p></div></div><button v-if="detail.status === 'error' && !detail.read_only && !isKiwix && !isMarginNote" class="kb-retry" :disabled="busy" @click="rebuild(true)"><LegacyIcon name="history" :size="14" />重试索引</button></header>
      <nav class="kb-detail-tabs" aria-label="知识库分区"><button v-for="item in detailSections" :key="item" :class="{ active: activeDetailSection === item }" @click="detailSection = item"><LegacyIcon :name="detailIcon(item)" :size="13" />{{ detailLabel(item) }}</button></nav>
      <div class="kb-detail-body"><section v-if="progress && (running || progress.error)" class="knowledge-progress"><div><strong>{{ progress.message || progress.stage || progress.status }}</strong><span>{{ progressPercent }}%</span></div><progress max="100" :value="progressPercent" :aria-label="`${detail.name} 索引进度`" /><p v-if="progress.error" class="error">{{ progress.error }}</p></section>
        <template v-if="activeDetailSection === 'files'"><KbFilesWorkspace :kb-name="detail.name" :files="files" :read-only="detail.read_only" @refresh="load" /></template>
        <template v-else-if="activeDetailSection === 'add'"><section class="kb-section"><header class="kb-section-heading"><div><h2>添加文档</h2><p>上传文件或整个文件夹，建立可检索的索引。</p></div></header><div v-if="!detail.read_only" class="kb-upload-panel"><label>目标子目录（可选）<input v-model="destSubdir" aria-label="目标子目录" placeholder="例如：guides"></label><div><label class="upload-button">上传文件 <input type="file" multiple :disabled="busy" @change="upload" /></label><label class="upload-button">上传文件夹 <input type="file" multiple webkitdirectory :disabled="busy" @change="upload" /></label></div></div><p v-else class="muted">此知识库为只读，不能上传文档。</p></section></template>
        <KbLinkedFolders v-else-if="activeDetailSection === 'folders'" :kb-name="detail.id || detail.name" :read-only="detail.read_only" />
        <KbSources v-else-if="activeDetailSection === 'github'" kind="github" :kb-name="detail.id || detail.name" :read-only="detail.read_only" />
        <KbSources v-else-if="activeDetailSection === 'web'" kind="web" :kb-name="detail.id || detail.name" :read-only="detail.read_only" />
        <KbVersions v-else-if="activeDetailSection === 'versions'" :versions="indexVersions" :read-only="detail.read_only" :busy="busy" @reindex="rebuild(false)" />
        <KbDevices v-else-if="activeDetailSection === 'devices'" :kb-name="detail.id || detail.name" />
        <KbKiwixArticles v-else-if="activeDetailSection === 'kiwix'" :kb-name="detail.id || detail.name" :title="String(detail.metadata?.zim_title || '')" :zim-name="String(detail.metadata?.zim_name || '')" />
        <KbSettings v-else-if="activeDetailSection === 'settings'" :kb="detail" :busy="busy" @set-default="setDefault" @delete="removeBase" @moved="router.push(`/knowledge-bases/${encodeURIComponent($event)}`)" />
      </div>
    </section>
  </main>
  <div v-if="createOpen" class="knowledge-create-overlay" @click.self="createOpen = false"><section class="knowledge-create-modal" role="dialog" aria-modal="true" :aria-label="sourcePreset ? '连接知识来源' : '创建知识库'"><header><div><h2>{{ sourcePreset === 'obsidian' ? '连接 Obsidian 仓库' : sourcePreset === 'marginnote4' ? '连接 MarginNote 4 资料库' : sourcePreset === 'kiwix' ? '连接 Kiwix 档案' : '＋ 创建知识库' }}</h2><p v-if="sourcePreset">连接现有知识来源，无需执行普通文档上传。</p></div><button aria-label="关闭" @click="createOpen = false">×</button></header><form v-if="sourcePreset" class="knowledge-source-create-form" @submit.prevent="create"><label>知识库名称<input v-model="newName" aria-label="知识库名称" required></label><label v-if="sourcePreset === 'obsidian'">仓库路径<input v-model="sourcePath" required placeholder="/Users/you/Documents/MyVault"></label><template v-else-if="sourcePreset === 'marginnote4'"><label>描述（可选）<textarea v-model="sourceDescription" rows="3" /></label><p class="muted">资料库初始为空。在“设备”页配对设备，然后在 MarginNote 4 插件中输入令牌开始同步。</p></template><template v-else><label>Kiwix 服务器 URL<input v-model="serverUrl" required placeholder="http://localhost:8080"></label><label>ZIM 名称<input v-model="zimName" required placeholder="wikipedia_en_all"></label><button type="button" :disabled="busy || !serverUrl.trim() || !zimName.trim()" @click="probeArchive">检查连接</button><span v-if="verifiedTitle">可用：{{ verifiedTitle }}</span></template><footer><button type="button" @click="createOpen = false">取消</button><button class="primary" :disabled="busy || !newName.trim()">{{ sourcePreset === 'kiwix' ? '连接档案' : sourcePreset === 'obsidian' ? '连接仓库' : '连接资料库' }}</button></footer></form><form v-else class="knowledge-standard-create-form" @submit.prevent="create"><div class="knowledge-create-scroll"><div class="knowledge-create-mode"><button type="button" :class="{ active: createMode === 'new' }" @click="createMode = 'new'"><strong>＋ 新建</strong><span>上传文档并建立全新索引。</span></button><button type="button" :class="{ active: createMode === 'link' }" @click="createMode = 'link'"><strong>↗ 关联已有</strong><span>复用你已建好的索引——就地读取，不上传、不重新索引。</span></button></div><label class="knowledge-create-name">知识库名称<input v-model="newName" aria-label="知识库名称" placeholder="例如：project-papers" required></label><section class="knowledge-provider-select"><h3>索引引擎</h3><div class="knowledge-provider-grid"><button v-for="provider in createProviders" :key="provider.id" type="button" :class="{ active: createProvider === provider.id }" @click="createProvider = provider.id"><span><KnowledgeEngineIcon :engine="provider.id" :size="24" /><strong>{{ provider.name }}</strong><small v-if="providerStatus(provider).label !== '可用'" :class="providerStatus(provider).tone">{{ providerStatus(provider).label }}</small><i v-if="createProvider === provider.id">✓</i></span><p>{{ provider.description }}</p></button></div></section><template v-if="createMode === 'new'"><div class="knowledge-engine-default"><div class="knowledge-engine-default-head"><div><span>引擎默认配置</span><p>此知识库会从已保存的引擎配置开始。</p></div><button type="button" @click="createOpen = false; openEngine(createProvider)">编辑默认配置 <LegacyIcon name="chevronRight" :size="12" /></button></div><div v-if="engineDefaultSummary.length" class="knowledge-engine-summary"><small v-for="item in engineDefaultSummary" :key="item">{{ item }}</small></div></div><label v-if="createNeedsEmbedding" class="knowledge-embedding-field">嵌入模型<select v-model="embeddingSelection" aria-label="嵌入模型" :disabled="embeddingLoading || Boolean(embeddingError)"><option value="">{{ embeddingLoading ? '加载中…' : '选择嵌入模型' }}</option><option v-for="option in embeddingOptions" :key="`${option.profile_id}:${option.model_id}`" :value="JSON.stringify([option.profile_id, option.model_id])">{{ option.label }} · {{ option.profile_name }}<template v-if="option.detail"> · {{ option.detail }}</template></option></select><small>此知识库始终使用所选模型，不受全局默认模型变更影响。</small><small v-if="embeddingError" class="error" role="alert">{{ embeddingError }}</small><RouterLink v-else-if="!embeddingLoading && !embeddingOptions.length" class="knowledge-embedding-link" to="/settings/embedding">请先在设置中配置嵌入模型。</RouterLink></label><label v-if="activeCreateProvider?.modes?.length" class="knowledge-embedding-field">检索模式<select v-model="createRetrievalMode" aria-label="检索模式"><option value="">使用引擎默认：{{ activeCreateProvider.default_mode || activeCreateProvider.modes[0] }}</option><option v-for="mode in activeCreateProvider.modes" :key="mode" :value="mode">{{ mode }}</option></select></label><section class="knowledge-initial-files"><h3>初始文档 <small>（可选）</small></h3><label class="knowledge-file-drop"><LegacyIcon name="plus" :size="18" /><strong>选择文件…</strong><span>点击选择受支持的文档</span><input type="file" multiple aria-label="创建时上传文件" @change="selectedFiles = Array.from(($event.target as HTMLInputElement).files || [])"></label><label class="knowledge-folder-upload">或上传文件夹（一次性导入）<input type="file" multiple webkitdirectory aria-label="上传文件夹" @change="selectedFiles = Array.from(($event.target as HTMLInputElement).files || [])"></label><p v-if="selectedFiles.length">已选择 {{ selectedFiles.length }} 个文件，将在创建后上传并建立索引。</p><p>暂时跳过，创建后可添加 GitHub 来源或上传文档。</p></section></template><template v-else><label class="knowledge-link-folder">{{ createProvider === 'obsidian' ? '仓库路径' : '文件夹路径' }}<input v-model="linkFolder" aria-label="文件夹路径" placeholder="/path/to/existing-index" required></label><p class="knowledge-link-note">不会上传或重新索引。请确认该目录包含与所选引擎兼容的现有索引。</p></template></div><footer class="knowledge-create-actions"><button type="button" @click="createOpen = false">取消</button><button class="primary" :disabled="createSubmitDisabled"><LegacyIcon v-if="!busy && createMode === 'new'" name="plus" :size="13" />{{ busy ? '处理中…' : createMode === 'link' ? '关联' : '创建' }}</button></footer></form></section></div>
</template>
