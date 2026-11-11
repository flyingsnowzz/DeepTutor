<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { writeStoredChatResponseTimeout } from '../chatTransport'
import { setTheme } from '../theme'
import LegacyIcon from '../components/LegacyIcon.vue'
import AppearanceSettings from '../components/AppearanceSettings.vue'
import ToolsSettings from '../components/ToolsSettings.vue'
import NetworkSettings from '../components/NetworkSettings.vue'
import StatusSettings from '../components/StatusSettings.vue'
import SettingsPresetsPanel from '../components/SettingsPresetsPanel.vue'
import ArchivedChatsSettings from '../components/ArchivedChatsSettings.vue'
import LearningProgressPage from './LearningProgressPage.vue'
import ModelCatalogSettings from '../components/ModelCatalogSettings.vue'
import VoicePlaybackPrefs from '../components/VoicePlaybackPrefs.vue'
import RuntimeSettingsSection from '../components/RuntimeSettingsSection.vue'
import GuardianSettings from '../components/GuardianSettings.vue'
import LearnerProfile from '../components/LearnerProfile.vue'
import SubagentSettings from '../components/SubagentSettings.vue'
import AgentSetupHelp from '../components/AgentSetupHelp.vue'
import SettingsTourOverlay from '../components/SettingsTourOverlay.vue'
import {
  clampToRange,
  effectiveAttachmentLimits,
  largerAttachmentUploadsNeedRestart,
  type AttachmentSettings,
  type AttachmentSettingsPayload,
  type StarterSettingsPayload,
} from '../settingsExtensions'

type UI = { theme?: string; language?: string; response_language?: string; voice_autoplay?: boolean; voice_math_speak?: boolean; chat_response_timeout?: number; enabled_optional_tools?: string[]; sidebar_description?: string; code_block_theme?: string; code_block_show_line_numbers?: boolean; code_block_wrap_long_lines?: boolean }
type Settings = { ui: UI; catalog?: unknown }
type Account = { is_admin?: boolean; preset?: string | null; learning_policy?: { role?: string } | null }
type NavItem = { key: string; label: string; blurb: string; icon: string; role?: 'learner' | 'guardian' }

const route = useRoute()
const router = useRouter()
const SETTINGS_RETURN_KEY = 'deeptutor:settings-return'
const aliases: Record<string, string> = { tts: 'voice', stt: 'voice', imagegen: 'multimodal', videogen: 'multimodal', overview: 'general', models: 'llm', chat: 'starters', agents: 'agent-claude-code', 'document-parsing': 'knowledge', image: 'multimodal', video: 'multimodal' }
const groups: { label: string; items: NavItem[] }[] = [
  { label: '个人', items: [
    { key: 'general', label: '常规', blurb: '界面语言、布局、回复语言与配置帮助', icon: 'settings' },
    { key: 'workspace', label: '工作区', blurb: '系统、通用与自建工作区，根目录与存储迁移', icon: 'folder' },
    { key: 'data-migration', label: '数据迁移', blurb: '查找、迁移和导出学习数据', icon: 'archive' },
    { key: 'appearance', label: '外观', blurb: '视觉主题与代码块', icon: 'appearance' },
    { key: 'usage', label: '用量统计', blurb: '模型用量与对话活跃情况', icon: 'chart' },
  ] },
  { label: '模型与服务', items: [
    { key: 'connections', label: '提供方', blurb: '管理提供方的名称、地址、密钥并测试连接。', icon: 'key' },
    { key: 'llm', label: '语言模型', blurb: '模型名称、上下文窗口、能力与连接测试。', icon: 'model' },
    { key: 'task-models', label: '后台任务模型', blurb: 'DeepTutor 自己发起的调用使用的模型。', icon: 'tasks' },
    { key: 'embedding', label: '嵌入模型', blurb: '嵌入模型、维度与连接测试。', icon: 'database' },
    { key: 'search', label: '搜索', blurb: '联网搜索供应商。', icon: 'search' },
    { key: 'voice', label: '语音', blurb: '使用已配置的提供方管理语音合成与语音识别模型。', icon: 'voice' },
    { key: 'multimodal', label: '多模态生成', blurb: '使用已配置的提供方管理图片与视频生成模型。', icon: 'image' },
  ] },
  { label: '学习与对话', items: [
    { key: 'starters', label: '对话', blurb: '主页输入框下方那三行引导的素材范围。', icon: 'chat' },
    { key: 'learner-profile', label: '学习档案', blurb: '调整年龄、年级与讲解偏好。', icon: 'profile', role: 'learner' },
    { key: 'progress', label: '学习进度', blurb: '阅读进度与近期学习操作', icon: 'chart' },
    { key: 'guardian', label: '监护管理', blurb: '查看已授权学习者与学习材料。', icon: 'shield', role: 'guardian' },
    { key: 'memory', label: '记忆', blurb: '分块、预算、去重与引用策略', icon: 'memory' },
  ] },
  { label: '功能与集成', items: [
    { key: 'tools', label: '工具', blurb: '对话智能体可调用的内置工具。', icon: 'tool' },
    { key: 'capabilities', label: '能力', blurb: '各能力的 LLM 参数与运行时旋钮。', icon: 'capability' },
    { key: 'knowledge', label: '知识与文档', blurb: '文档解析引擎', icon: 'document' },
  ] },
  { label: '系统', items: [
    { key: 'network', label: '网络', blurb: '端口、浏览器 API 地址与 CORS', icon: 'network' },
    { key: 'presets', label: '配置起点', blurb: '将常用配置加载为草稿，应用后生效。', icon: 'sparkles' },
    { key: 'status', label: '运行状态', blurb: '服务就绪情况、诊断与内存占用', icon: 'activity' },
    { key: 'about', label: '关于', blurb: '版本、更新与项目资源', icon: 'info' },
  ] },
  { label: '已归档', items: [
    { key: 'archive', label: '已归档的聊天', blurb: '搜索、取消归档或永久删除已归档的对话', icon: 'archive' },
  ] },
]
const agentKinds: Record<string, string> = { 'agent-claude-code': 'claude_code', 'agent-codex': 'codex', 'agent-grok': 'grok', 'agent-antigravity': 'antigravity', 'agent-kimi': 'kimi', 'agent-opencode': 'opencode', 'agent-mimo': 'mimo', 'agent-hermes': 'hermes', 'agent-hermes-remote': 'hermes_remote', 'agent-openclaw': 'openclaw', 'agent-deepseek-harness': 'deepseek_harness' }
const agentLabels: Record<string, string> = { 'agent-claude-code': 'Claude Code', 'agent-codex': 'Codex', 'agent-grok': 'Grok CLI', 'agent-antigravity': 'Antigravity', 'agent-kimi': 'Kimi CLI', 'agent-opencode': 'opencode', 'agent-mimo': 'MiMo', 'agent-hermes': 'Hermes', 'agent-hermes-remote': 'Hermes Remote', 'agent-openclaw': 'OpenClaw', 'agent-deepseek-harness': 'DeepSeek Harness' }
const section = computed(() => aliases[String(route.params.section || 'general')] || String(route.params.section || 'general'))
const ui = reactive<UI>({})
const liveUi = reactive<UI>({})
const draftExtensions = reactive<Record<string, unknown>>({})
const liveExtensions = reactive<Record<string, unknown>>({})
const tools = ['brainstorm', 'web_search', 'paper_search', 'zotero_search', 'reason', 'geogebra_analysis', 'imagegen', 'videogen']
const starters = ref(20)
const enabledTools = ref<string[]>([])
const attachments = reactive<AttachmentSettings>({ max_file_mb: 20, max_total_mb: 25, max_chars_per_doc: 200000, max_chars_total: 150000 })
const attachmentPayload = ref<AttachmentSettingsPayload | null>(null)
const starterPayload = ref<StarterSettingsPayload | null>(null)
const attachmentLive = ref<AttachmentSettings>({ ...attachments })
const starterBounds = computed<[number, number]>(() => starterPayload.value?.bounds?.trace_count ?? [3, 100])
const attachmentFileBounds = computed<[number, number]>(() => attachmentPayload.value?.bounds?.max_file_mb ?? [1, 1024])
const attachmentTotalBounds = computed<[number, number]>(() => attachmentPayload.value?.bounds?.max_total_mb ?? [1, 2048])
const attachmentCharBounds = computed<[number, number]>(() => attachmentPayload.value?.bounds?.chars ?? [10000, 5_000_000])
const effectiveLimits = computed(() => effectiveAttachmentLimits(attachmentPayload.value))
const restartRequiredForAttachmentDraft = computed(() =>
  attachmentPayload.value
    ? largerAttachmentUploadsNeedRestart(attachmentLive.value, attachments, attachmentPayload.value)
    : false,
)
const readiness = ref<unknown>(null)
const isAdmin = ref(false)
const catalogEditable = ref(false)
const catalogDraft = ref<unknown>(null)
const account = ref<Account>({})
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const navQuery = ref('')
const mobileOpen = ref(false)
const leaving = ref(false)
const draftState = ref<'clean' | 'unsaved' | 'saved'>('clean')
const toolbarToast = ref('')
const settingsRevision = ref(0)
const tourStepIndex = ref(-1)
const storedLayout = () => localStorage.getItem('deeptutor.ui-layout') === 'classic' ? 'classic' : 'modern'
const uiLayout = ref<'classic' | 'modern'>(storedLayout())
const liveLayout = ref<'classic' | 'modern'>(uiLayout.value)
const languages = [{ value: 'en', label: 'English' }, { value: 'zh', label: '中文' }, { value: 'fr', label: 'Français' }, { value: 'de', label: '德语' }, { value: 'uk', label: '乌克兰语' }, { value: 'pl', label: '波兰语' }]
const responseLanguages = [{ value: 'en', label: 'English' }, { value: 'zh', label: '简体中文' }, { value: 'zh-tw', label: '繁體中文' }, { value: 'ja', label: '日本語' }, { value: 'ko', label: '한국어' }, { value: 'es', label: 'Español' }, { value: 'fr', label: 'Français' }, { value: 'de', label: 'Deutsch' }, { value: 'ru', label: 'Русский' }, { value: 'pt', label: 'Português' }, { value: 'it', label: 'Italiano' }, { value: 'ar', label: 'العربية' }, { value: 'pl', label: 'Polski' }, { value: 'uk', label: 'Українська' }, { value: 'ms', label: 'Bahasa Melayu' }]
const uiPayload = computed(() => ({ theme: ui.theme || 'snow', language: ui.language || 'zh', response_language: ui.response_language || ui.language || 'zh', code_block_theme: ui.code_block_theme || 'oneDark', code_block_show_line_numbers: ui.code_block_show_line_numbers ?? true, code_block_wrap_long_lines: ui.code_block_wrap_long_lines ?? false }))
const extensionDirty = computed(() => Object.keys(draftExtensions).some(key => JSON.stringify(draftExtensions[key]) !== JSON.stringify(liveExtensions[key])))
const generalDirty = computed(() => JSON.stringify(uiPayload.value) !== JSON.stringify({ theme: liveUi.theme || 'snow', language: liveUi.language || 'zh', response_language: liveUi.response_language || liveUi.language || 'zh', code_block_theme: liveUi.code_block_theme || 'oneDark', code_block_show_line_numbers: liveUi.code_block_show_line_numbers ?? true, code_block_wrap_long_lines: liveUi.code_block_wrap_long_lines ?? false }) || uiLayout.value !== liveLayout.value)
const hasUnsavedChanges = computed(() => generalDirty.value || extensionDirty.value || draftState.value !== 'clean')
const visibleGroups = computed(() => groups
  .map(group => ({
    ...group,
    items: group.items.filter(item => !item.role || account.value.preset === item.role || account.value.learning_policy?.role === item.role || item.role === 'guardian'),
  }))
  .filter(group => group.items.length),
)
const searchResults = computed(() => {
  const query = navQuery.value.trim().toLocaleLowerCase()
  if (!query) return []
  return visibleGroups.value.flatMap(group => group.items).filter(item => `${item.label} ${item.blurb} ${item.key} ${item.key === 'connections' ? 'API Key token base url 密钥 凭据 地址 供应商' : ''}`.toLocaleLowerCase().includes(query))
})

watch(generalDirty, dirty => { if (dirty && draftState.value === 'clean') draftState.value = 'unsaved'; if (!dirty) draftState.value = 'clean' })

async function load() {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const [settings, auth] = await Promise.all([api<Settings>('/api/settings').catch((): Settings => ({ ui: {} })), api<Account>('/api/auth/status')])
    Object.assign(liveUi, settings.ui)
    if (draftState.value === 'clean') Object.assign(ui, settings.ui)
    catalogEditable.value = Boolean(settings.catalog)
    catalogDraft.value = settings.catalog ?? null
    const stored = await api<{ draft: { catalog?: unknown; extensions?: Record<string, unknown> } | null }>('/api/settings/draft').catch(() => ({ draft: null }))
    if (stored.draft && draftState.value === 'clean') {
      if (stored.draft.catalog) catalogDraft.value = stored.draft.catalog
      const extensions = stored.draft.extensions ?? {}
      if (extensions.ui) Object.assign(ui, extensions.ui)
      if (extensions['ui-layout'] === 'classic' || extensions['ui-layout'] === 'modern') uiLayout.value = extensions['ui-layout']
      for (const [key, value] of Object.entries(extensions)) {
        if (key !== 'ui' && key !== 'ui-layout') draftExtensions[key] = value
      }
      if (extensions['chat-starters']) starters.value = Number((extensions['chat-starters'] as { trace_count: number }).trace_count)
      if (extensions['chat-attachments']) Object.assign(attachments, extensions['chat-attachments'])
      if (extensions.tools) enabledTools.value = [...((extensions.tools as { enabled_tools?: string[] }).enabled_tools ?? [])]
      draftState.value = 'saved'
      toolbarToast.value = '草稿尚未应用'
    }
    account.value = auth
    isAdmin.value = Boolean(auth.is_admin)
    liveLayout.value = storedLayout()
    if (draftState.value === 'clean') uiLayout.value = liveLayout.value
    if (draftState.value === 'clean') liveExtensions['chat-timeout'] = { chat_response_timeout: settings.ui.chat_response_timeout || 300 }
    if (settings.ui.chat_response_timeout) writeStoredChatResponseTimeout(Number(settings.ui.chat_response_timeout))
    if (section.value === 'starters') {
      const payload = await api<StarterSettingsPayload>('/api/settings/chat-starters')
      starterPayload.value = payload
      liveExtensions['chat-starters'] = { ...payload.settings }
      if (draftState.value === 'clean') starters.value = payload.settings.trace_count
    }
    if (section.value === 'attachments') {
      const payload = await api<AttachmentSettingsPayload>('/api/settings/chat-attachments')
      attachmentPayload.value = payload
      attachmentLive.value = { ...payload.settings }
      liveExtensions['chat-attachments'] = { ...payload.settings }
      if (draftState.value === 'clean') Object.assign(attachments, payload.settings)
    }
    if (section.value === 'status') readiness.value = await api('/api/settings/readiness')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '设置加载失败' }
  finally { loading.value = false }
}
onMounted(() => {
  if (route.path === '/settings') void router.replace('/settings/general')
  else if (String(route.params.section || '') !== section.value) void router.replace(`/settings/${section.value}`)
})
watch(() => route.fullPath, () => {
  mobileOpen.value = false
  const raw = String(route.params.section || 'general')
  if (raw !== section.value) return router.replace(`/settings/${section.value}`)
  return load()
}, { immediate: true })
async function save(path: string, payload: unknown) {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await api(`/api/settings${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    notice.value = '设置已保存'
    await load()
    notice.value = '设置已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
function toggleTool(name: string) {
  const current = new Set(ui.enabled_optional_tools ?? tools)
  if (current.has(name)) current.delete(name); else current.add(name)
  ui.enabled_optional_tools = tools.filter(tool => current.has(tool))
}
function stageExtension(key: string, payload: unknown) {
  draftExtensions[key] = payload
  stageGeneral()
}
function loadedNetwork(value: unknown) { liveExtensions.network = value }
function loadedRuntime(section: string, value: unknown) { liveExtensions[section] = value }
function loadedMinerU(value: unknown) { liveExtensions.mineru = value }
function stageTimeout() { stageExtension('chat-timeout', { chat_response_timeout: ui.chat_response_timeout || 300 }) }
function stageStarters() { stageExtension('chat-starters', { trace_count: starters.value }) }
function stageAttachments() { stageExtension('chat-attachments', { ...attachments }) }
function updateTools(value: string[]) {
  enabledTools.value = [...value].sort()
  stageExtension('tools', { enabled_tools: enabledTools.value })
}
function loadedTools(value: string[]) {
  const next = [...value].sort()
  liveExtensions.tools = { enabled_tools: next }
  if (draftState.value === 'clean' || !draftExtensions.tools) enabledTools.value = next
}
function updateAppearance(patch: Partial<UI>) {
  Object.assign(ui, patch)
  stageGeneral()
}
function stageGeneral() {
  draftState.value = 'unsaved'
  toolbarToast.value = ''
}
function draftEnvelope() {
  return { catalog: catalogEditable.value ? catalogDraft.value : null, extensions: { ...draftExtensions, ...(generalDirty.value ? { ui: uiPayload.value, 'ui-layout': uiLayout.value } : {}) } }
}
async function saveGeneralDraft() {
  busy.value = true
  error.value = ''
  try {
    await api('/api/settings/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftEnvelope()) })
    draftState.value = 'saved'
    toolbarToast.value = '草稿已保存，尚未应用'
    return true
  } catch (cause) {
    toolbarToast.value = `无法保存草稿：${cause instanceof Error ? cause.message : '保存失败'}`
    return false
  } finally { busy.value = false }
}
async function discardGeneral() {
  busy.value = true
  try {
    await api('/api/settings/draft', { method: 'DELETE' }).catch(() => null)
    Object.assign(ui, liveUi)
    uiLayout.value = liveLayout.value
    for (const key of Object.keys(draftExtensions)) delete draftExtensions[key]
    const timeout = liveExtensions['chat-timeout'] as { chat_response_timeout?: number } | undefined
    if (timeout?.chat_response_timeout) ui.chat_response_timeout = timeout.chat_response_timeout
    const starter = liveExtensions['chat-starters'] as { trace_count?: number } | undefined
    if (starter?.trace_count) starters.value = starter.trace_count
    if (liveExtensions['chat-attachments']) Object.assign(attachments, liveExtensions['chat-attachments'])
    Object.assign(attachments, attachmentLive.value)
    const toolSettings = liveExtensions.tools as { enabled_tools?: string[] } | undefined
    if (toolSettings?.enabled_tools) enabledTools.value = [...toolSettings.enabled_tools]
    draftState.value = 'clean'
    toolbarToast.value = ''
    settingsRevision.value += 1
  } finally { busy.value = false }
}
async function applyGeneral() {
  busy.value = true
  error.value = ''
  try {
    await api('/api/settings/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftEnvelope()) })
    const endpoints: Record<string, string> = { tools: '/api/settings/enabled-tools', 'chat-starters': '/api/settings/chat-starters', 'chat-attachments': '/api/settings/chat-attachments', 'chat-timeout': '/api/settings/chat-response-timeout', network: '/api/settings/network', capabilities: '/api/capabilities/settings', memory: '/api/memory/settings', knowledge: '/api/settings/document-parsing', 'video-learning': '/api/settings/video-learning', mineru: '/api/settings/mineru' }
    for (const [key, payload] of Object.entries(draftExtensions)) {
      const endpoint = endpoints[key]
      if (!endpoint) throw new Error(`未知设置分区：${key}`)
      const response = await api<unknown>(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      liveExtensions[key] = payload
      if (key === 'chat-timeout') liveUi.chat_response_timeout = (payload as { chat_response_timeout: number }).chat_response_timeout
      if (key === 'chat-attachments') {
        const next = response as AttachmentSettingsPayload
        attachmentPayload.value = next
        attachmentLive.value = { ...next.settings }
        Object.assign(attachments, next.settings)
      }
      if (key === 'chat-starters') {
        const next = response as StarterSettingsPayload
        starterPayload.value = next
        starters.value = next.settings.trace_count
      }
      delete draftExtensions[key]
    }
    if (generalDirty.value) {
      await api('/api/settings/ui', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(uiPayload.value) })
      setTheme((uiPayload.value.theme || 'snow') as 'light' | 'dark' | 'glass' | 'snow')
      localStorage.setItem('deeptutor.ui-layout', uiLayout.value)
      document.documentElement.setAttribute('data-ui-layout', uiLayout.value)
      window.dispatchEvent(new CustomEvent('deeptutor:ui-layout', { detail: { layout: uiLayout.value } }))
    }
    await api('/api/settings/draft', { method: 'DELETE' }).catch(() => null)
    Object.assign(liveUi, uiPayload.value)
    liveLayout.value = uiLayout.value
    draftState.value = 'clean'
    toolbarToast.value = '已应用'
    settingsRevision.value += 1
  } catch (cause) { toolbarToast.value = `无法应用：${cause instanceof Error ? cause.message : '保存失败'}` }
  finally { busy.value = false }
}
function normalizeReturn(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/settings')) return '/chat'
  return value
}
function rememberReturn() {
  const current = normalizeReturn(sessionStorage.getItem(SETTINGS_RETURN_KEY))
  void router.push(current)
}
function returnToApp() { rememberReturn() }
function requestReturn() { if (hasUnsavedChanges.value) leaving.value = true; else returnToApp() }
async function saveDraftAndReturn() { if (await saveGeneralDraft()) returnToApp() }
</script>

<template>
  <main class="legacy-settings-shell" data-settings-shell>
    <button v-if="mobileOpen" type="button" class="legacy-settings-nav-backdrop" aria-label="关闭设置导航" @click="mobileOpen = false" />
    <aside class="legacy-settings-nav" :class="{ 'mobile-open': mobileOpen }">
      <div class="legacy-settings-return"><button type="button" :disabled="busy" @click="requestReturn"><LegacyIcon name="chevronLeft" :size="16" />返回应用</button><button type="button" class="legacy-settings-mobile-close" aria-label="关闭" @click="mobileOpen = false"><LegacyIcon name="close" :size="17" /></button></div>
      <nav aria-label="设置分区" class="legacy-settings-nav-body">
        <div class="legacy-settings-search"><LegacyIcon name="search" :size="14" /><input v-model="navQuery" aria-label="搜索设置" placeholder="搜索设置" type="search"><button v-if="navQuery" type="button" aria-label="清除" @click="navQuery = ''"><LegacyIcon name="close" :size="13" /></button></div>
        <div class="legacy-settings-nav-scroll">
          <template v-if="!navQuery.trim()">
            <div v-for="group in visibleGroups" :key="group.label" class="legacy-settings-nav-group">
              <p>{{ group.label }}</p>
              <RouterLink v-for="item in group.items" :key="item.key" :to="`/settings/${item.key}`" :title="item.blurb" :aria-current="section === item.key || (item.key === 'agent-claude-code' && agentKinds[section]) ? 'page' : undefined" @click="mobileOpen = false"><LegacyIcon :name="item.icon" :size="15" /><span>{{ item.label }}</span></RouterLink>
            </div>
          </template>
          <div v-else class="legacy-settings-nav-group legacy-settings-search-results">
            <p>搜索结果</p>
            <RouterLink v-for="item in searchResults" :key="item.key" :to="`/settings/${item.key}`" :title="item.blurb" :aria-current="section === item.key ? 'page' : undefined" @click="mobileOpen = false"><LegacyIcon :name="item.icon" :size="15" /><span>{{ item.label }}</span></RouterLink>
            <p v-if="!searchResults.length" class="legacy-settings-no-results">没有与“{{ navQuery.trim() }}”匹配的设置。</p>
          </div>
        </div>
      </nav>
    </aside>
    <section class="legacy-settings-main">
      <header class="legacy-settings-mobile-bar"><button type="button" @click="requestReturn"><LegacyIcon name="chevronLeft" :size="16" />返回应用</button><button type="button" aria-label="设置分区" :aria-expanded="mobileOpen" @click="mobileOpen = true"><LegacyIcon name="menu" :size="20" /></button></header>
      <div class="legacy-settings-scroll" data-settings-scroll>
        <div class="legacy-settings-container" :class="{ wide: ['connections', 'llm', 'embedding', 'search', 'voice', 'multimodal'].includes(section) }" tabindex="-1">
          <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="loading" class="legacy-settings-loading">加载中…</p>
          <nav v-if="agentKinds[section]" class="legacy-settings-family" aria-label="相关设置"><RouterLink v-for="(_, key) in agentKinds" :key="key" :to="`/settings/${key}`" :aria-current="section === key ? 'page' : undefined">{{ agentLabels[key] }}</RouterLink></nav>
          <fieldset class="legacy-settings-fieldset" :disabled="busy || loading" :aria-busy="busy || loading">
          <template v-if="section === 'general'">
            <header class="legacy-settings-page-header"><h1>常规</h1><p>按你的习惯配置 DeepTutor，通过底部操作栏应用更改。</p></header>
            <section class="legacy-setting-section"><h2>语言</h2><div class="legacy-setting-section-body">
              <div class="legacy-setting-row"><div><h3>界面语言</h3><p>只控制导航、设置和状态文案。</p></div><select v-model="ui.language" aria-label="界面语言" @change="stageGeneral"><option v-for="item in languages" :key="item.value" :value="item.value">{{ item.label }}</option></select></div>
              <div class="legacy-setting-row"><div><h3>模型输出语言</h3><p>设置聊天及各项能力回复所使用的默认语言。</p></div><select v-model="ui.response_language" aria-label="模型输出语言" @change="stageGeneral"><option v-for="item in responseLanguages" :key="item.value" :value="item.value">{{ item.label }}</option></select></div>
            </div></section>
            <section class="legacy-setting-section"><h2>布局</h2><div class="legacy-setting-section-body"><div class="legacy-setting-row"><div><h3>界面布局</h3><p>经典保留熟悉的导航；现代是重新设计的新界面。</p></div><select v-model="uiLayout" aria-label="界面布局" @change="stageGeneral"><option value="classic">经典</option><option value="modern">现代</option></select></div></div></section>
            <template v-if="catalogEditable">
              <section class="legacy-setting-section"><header class="legacy-settings-tour-heading"><div><h2>先配置对话</h2><p>连接提供方并选择语言模型，即可开始对话。其他服务可以按需配置。</p></div><button type="button" class="legacy-settings-tour-button" @click="tourStepIndex = 0"><LegacyIcon name="sparkles" :size="14" />运行设置引导</button></header><div class="legacy-setting-section-body legacy-setting-links">
                <AgentSetupHelp />
                <RouterLink to="/settings/connections"><div><h3>1. 连接提供方</h3><p>添加提供方与认证信息，然后测试连接。</p></div><LegacyIcon name="chevronRight" :size="17" /></RouterLink>
                <RouterLink to="/settings/llm"><div><h3>2. 选择对话模型</h3><p>添加语言模型、完成测试，并设为默认对话模型。</p></div><LegacyIcon name="chevronRight" :size="17" /></RouterLink>
                <RouterLink to="/settings/status"><div><h3>3. 应用配置并检查</h3><p>通过底部操作栏应用更改，再查看服务状态，确认后即可开始对话。</p></div><LegacyIcon name="chevronRight" :size="17" /></RouterLink>
              </div></section>
              <section class="legacy-setting-section"><header><h2>按需扩展</h2><p>以下服务不影响基础对话，可在需要时配置。</p></header><div class="legacy-setting-section-body legacy-setting-links legacy-setting-optional-links">
                <RouterLink to="/settings/embedding"><div><h3>知识库检索</h3><p>建立知识库索引前，先配置嵌入模型。</p></div><LegacyIcon name="chevronRight" :size="17" /></RouterLink>
                <RouterLink to="/settings/search"><div><h3>联网搜索</h3><p>连接搜索服务，让对话能够查找网页信息。</p></div><LegacyIcon name="chevronRight" :size="17" /></RouterLink>
                <RouterLink to="/settings/task-models"><div><h3>后台任务模型</h3><p>为标题生成、建议等自动任务选择模型。</p></div><LegacyIcon name="chevronRight" :size="17" /></RouterLink>
              </div></section>
            </template>
          </template>
        <AppearanceSettings v-else-if="section === 'appearance'" :ui="ui" @change="updateAppearance" />
        <LearningProgressPage v-else-if="section === 'progress'" embedded />
        <NetworkSettings v-else-if="section === 'network'" :pending="draftExtensions.network" :revision="settingsRevision" @change="stageExtension('network', $event)" @loaded="loadedNetwork" />
        <ToolsSettings v-else-if="section === 'tools'" :enabled-tools="enabledTools" @change="updateTools" @loaded="loadedTools" />
        <template v-else-if="section === 'starters'">
          <header class="legacy-settings-page-header"><h1>对话</h1><p>管理主页建议，以及 DeepTutor 等待回复的时长。</p></header>
          <section class="legacy-setting-section"><header><h2>聊天响应超时</h2><p>对话等待回复的时长，超时后显示错误。图片或视频生成等较慢工具可适当延长。</p></header><div class="legacy-setting-section-body"><div class="legacy-setting-row"><div><h3>超时时长（秒）</h3><p>30–1800 秒，立即生效，无需重启。</p></div><input v-model.number="ui.chat_response_timeout" class="legacy-setting-number" type="number" min="30" max="1800" aria-label="超时时长（秒）" @input="stageTimeout"></div></div></section>
          <section class="legacy-setting-section"><header><h2>起始建议</h2><p>始终包含你的整合记忆。这里控制附带多少近期原始活动，包括对话、练习题、搜索和文档，并按时间排序。</p></header><div class="legacy-setting-section-body"><div class="legacy-setting-row"><div><h3>近期活动条数</h3><p>条数越多，模型可看到更长的学习轨迹；条数越少，越聚焦本周。下次生成建议时生效。</p></div><input v-model.number="starters" class="legacy-setting-number" type="number" :min="starterBounds[0]" :max="starterBounds[1]" aria-label="近期活动条数" @input="starters = clampToRange(starters, starterBounds); stageStarters()"></div></div></section>
          <p class="legacy-settings-footnote">这些建议由当前模型生成，除非你固定了某一条。<RouterLink to="/settings/task-models">后台任务模型 ↗</RouterLink></p>
        </template>
        <template v-else-if="section === 'attachments'">
          <header class="legacy-settings-page-header"><h1>附件</h1><p>聊天附件的上传上限与文本提取预算，适用于主对话、书籍、练习追问和伙伴。</p></header>
          <section class="legacy-setting-section"><header><h2>大小限制</h2><p>应用后，降低限制会立即生效；提高限制需要重启后端，以便 WebSocket 接收更大的上传内容。</p></header><div class="legacy-setting-section-body">
            <div class="legacy-setting-row"><div><h3>单文件上限（MB）</h3><p>输入框接受的单个文件最大大小。</p></div><input v-model.number="attachments.max_file_mb" class="legacy-setting-number" type="number" :min="attachmentFileBounds[0]" :max="attachmentFileBounds[1]" aria-label="单文件上限（MB）" @input="attachments.max_file_mb = clampToRange(attachments.max_file_mb, attachmentFileBounds); stageAttachments()"></div>
            <div class="legacy-setting-row"><div><h3>每条消息总上限（MB）</h3><p>一条消息所有附件的合计大小，不会低于单文件上限。</p></div><input v-model.number="attachments.max_total_mb" class="legacy-setting-number" type="number" :min="attachmentTotalBounds[0]" :max="attachmentTotalBounds[1]" aria-label="每条消息总上限（MB）" @input="attachments.max_total_mb = clampToRange(attachments.max_total_mb, attachmentTotalBounds); stageAttachments()"></div>
          </div></section>
          <section class="legacy-setting-section"><header><h2>提取预算</h2><p>文档会转换为文本并放入模型上下文。这些预算限制单文件和整条消息可贡献的文本量；较大文档可提高预算，但会占用更多上下文和 Token。</p></header><div class="legacy-setting-section-body">
            <div class="legacy-setting-row"><div><h3>单文档字符上限</h3><p>单个文件超过此长度的提取文本会被截断并附带提示。</p></div><input v-model.number="attachments.max_chars_per_doc" class="legacy-setting-number wide" type="number" :min="attachmentCharBounds[0]" :max="attachmentCharBounds[1]" step="10000" aria-label="单文档字符上限" @input="attachments.max_chars_per_doc = clampToRange(attachments.max_chars_per_doc, attachmentCharBounds); stageAttachments()"></div>
            <div class="legacy-setting-row"><div><h3>每条消息字符上限</h3><p>一条消息中所有文档提取文本的总上限。</p></div><input v-model.number="attachments.max_chars_total" class="legacy-setting-number wide" type="number" :min="attachmentCharBounds[0]" :max="attachmentCharBounds[1]" step="10000" aria-label="每条消息字符上限" @input="attachments.max_chars_total = clampToRange(attachments.max_chars_total, attachmentCharBounds); stageAttachments()"></div>
          </div></section>
          <p v-if="restartRequiredForAttachmentDraft" class="legacy-settings-warning">提高上传大小上限后需要重启后端，新的 WebSocket 帧上限才会生效；降低限制和字符预算会立即生效。</p>
          <p v-if="effectiveLimits" class="legacy-settings-footnote">运行时 WebSocket 上限：{{ Math.round(effectiveLimits.ws_max_size / 1024 / 1024) }} MB；单文件 {{ Math.round(effectiveLimits.max_file_bytes / 1024 / 1024) }} MB；单条消息 {{ Math.round(effectiveLimits.max_total_bytes / 1024 / 1024) }} MB。</p>
          <p class="legacy-settings-footnote">注意：图片会原样发送给模型提供方，因此不受这些上限影响，提供方自身的大小限制仍然适用。</p>
        </template>
        <SettingsPresetsPanel v-else-if="section === 'presets'" />
        <div v-else-if="section === 'status'" data-tour="tour-status"><StatusSettings /></div>
        <ModelCatalogSettings v-else-if="['connections', 'llm', 'task-models', 'embedding', 'search', 'tts', 'stt', 'imagegen', 'videogen'].includes(section)" :key="section" :section="section" />
        <div v-else-if="section === 'voice'" class="settings-model-group"><header class="model-page-header"><h1>语音</h1><p>使用已配置的提供方管理语音合成与语音识别模型。</p></header><VoicePlaybackPrefs /><ModelCatalogSettings section="tts" embedded /><ModelCatalogSettings section="stt" embedded /></div>
        <div v-else-if="section === 'multimodal'" class="settings-model-group"><header class="model-page-header"><h1>多模态生成</h1><p>使用已配置的提供方管理图片与视频生成模型。</p></header><ModelCatalogSettings section="imagegen" embedded /><ModelCatalogSettings section="videogen" embedded /></div>
        <ArchivedChatsSettings v-else-if="section === 'archive'" />
        <RuntimeSettingsSection v-else-if="['capabilities', 'memory', 'knowledge', 'video-learning', 'usage', 'workspace', 'data-migration', 'about'].includes(section)" :key="section" :section="section" :pending="draftExtensions[section]" :mineru-pending="draftExtensions.mineru" :revision="settingsRevision" @change="stageExtension(section, $event)" @loaded="loadedRuntime(section, $event)" @mineru-change="stageExtension('mineru', $event)" @mineru-loaded="loadedMinerU" />
        <GuardianSettings v-else-if="section === 'guardian'" />
        <LearnerProfile v-else-if="section === 'learner-profile'" />
        <SubagentSettings v-else-if="agentKinds[section]" :key="section" :kind="agentKinds[section]" />
        <template v-else><h2>此设置页不可用</h2><RouterLink to="/settings/general">返回设置</RouterLink></template>
          </fieldset>
        </div>
      </div>
      <div v-if="draftState !== 'clean'" class="legacy-settings-toolbar">
        <div class="legacy-settings-toolbar-inner"><div role="status"><strong>{{ draftState === 'saved' ? '草稿尚未应用' : '有未保存的更改' }}</strong><p>{{ toolbarToast || '应用所有设置页面中的待处理更改。' }}</p></div><div><button type="button" :disabled="busy" @click="discardGeneral"><LegacyIcon name="undo" :size="14" />放弃</button><button type="button" :disabled="busy || draftState !== 'unsaved'" @click="saveGeneralDraft"><LegacyIcon name="save" :size="14" />存草稿</button><button type="button" class="legacy-settings-apply" :disabled="busy" @click="applyGeneral"><LegacyIcon name="check" :size="14" />应用更改</button></div></div>
      </div>
      <div v-else-if="toolbarToast" role="status" class="legacy-settings-toast">{{ toolbarToast }}</div>
    </section>
    <div v-if="leaving" class="legacy-settings-modal-overlay" @click.self="leaving = false"><section class="legacy-settings-modal" role="dialog" aria-modal="true" aria-label="保留更改？"><header><h2>保留更改？</h2><button type="button" aria-label="关闭" @click="leaving = false"><LegacyIcon name="close" :size="17" /></button></header><div class="legacy-settings-modal-body"><p>先保存草稿再离开。你可以稍后返回并应用；当前设置会继续生效。</p><div><button type="button" :disabled="busy" @click="leaving = false">继续编辑</button><button type="button" class="legacy-settings-apply" :disabled="busy" @click="saveDraftAndReturn">保存草稿并返回</button></div><button type="button" class="legacy-settings-leave" :disabled="busy" @click="returnToApp">不保存，直接返回</button></div></section></div>
    <SettingsTourOverlay v-if="tourStepIndex >= 0" v-model:step-index="tourStepIndex" @close="tourStepIndex = -1" />
  </main>
</template>
