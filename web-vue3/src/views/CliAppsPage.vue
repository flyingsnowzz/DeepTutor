<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api'
import { scopedUrl } from '../workspaceScope'
import LegacyIcon from '../components/LegacyIcon.vue'
import CliBrandIcon from '../components/CliBrandIcon.vue'

interface App { id: string; display_name: string; description: string; tool_name: string; category: string; trust: string; granted: boolean; enabled: boolean; installed_at?: string; in_catalog: boolean; pin?: string }
interface CatalogEntry { id: string; display_name: string; description: string; category: string; trust: string; installed: boolean; installable?: boolean; unsupported_reason?: string; install_notes?: string; source_url?: string; homepage?: string; runtime?: string; requires?: string; install_target?: string; pinned?: boolean }
interface State { apps: App[]; access: { exec_denied: boolean }; log?: string }
const state = ref<State | null>(null)
const entries = ref<CatalogEntry[]>([])
const categories = ref<Record<string, number>>({})
const cursor = ref('')
const total = ref(0)
const tab = ref<'installed' | 'store'>('installed')
const search = ref('')
const category = ref('')
const showAll = ref(false)
const loading = ref(false)
const initialLoading = ref(true)
const busy = ref('')
const error = ref('')
const notice = ref('')
const admin = ref(false)
const selected = ref<CatalogEntry | null>(null)
const installLog = ref('')
const cliMenuOpen = ref(false)
let catalogVersion = 0
let mounted = true
const usable = computed(() => state.value?.apps.filter(item => item.granted && item.enabled).length || 0)
const categoryChips = computed(() => Object.entries(categories.value).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]))
function trustLabel(trust: string, pinned = false) { return trust === 'first-party' ? '已固定版本' : pinned ? '第三方' : '第三方，未固定版本' }
function trustTone(trust: string) { return trust === 'first-party' ? 'pinned' : 'warn' }
function formatDay(value?: string) { return value ? new Date(value).toLocaleDateString('zh-CN') : '' }
async function load() {
  initialLoading.value = true
  try {
    const [apps, auth] = await Promise.all([api<State>('/api/space/cli-apps/apps'), api<{ is_admin?: boolean }>('/api/auth/status')])
    state.value = apps; admin.value = Boolean(auth.is_admin)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'CLI 应用加载失败' }
  finally { initialLoading.value = false }
}
async function loadCatalog(more = false) {
  const version = ++catalogVersion
  loading.value = true; error.value = ''
  try {
    const params = new URLSearchParams({ q: search.value.trim(), category: category.value, limit: '12' })
    if (showAll.value) params.set('installable_only', 'false')
    if (more && cursor.value) params.set('cursor', cursor.value)
    const result = await api<{ entries: CatalogEntry[]; categories: Record<string, number>; next_cursor: string; total: number }>(`/api/space/cli-apps/catalog?${params}`)
    if (version !== catalogVersion || !mounted) return
    const existing = new Set(entries.value.map(entry => entry.id))
    entries.value = more ? [...entries.value, ...result.entries.filter(entry => !existing.has(entry.id))] : result.entries
    categories.value = result.categories; cursor.value = result.next_cursor; total.value = result.total
  } catch (cause) { if (version === catalogVersion) error.value = cause instanceof Error ? cause.message : '应用目录加载失败' }
  finally { if (version === catalogVersion) loading.value = false }
}
let timer: ReturnType<typeof setTimeout> | undefined
onMounted(load)
onUnmounted(() => { mounted = false; catalogVersion++; if (timer) clearTimeout(timer) })
watch([tab, category, showAll], () => { if (tab.value === 'store') { selected.value = null; void loadCatalog() } })
watch(search, () => { clearTimeout(timer); timer = setTimeout(() => { if (tab.value === 'store') void loadCatalog() }, 250) })
function openEntry(entry: CatalogEntry) { selected.value = entry; installLog.value = ''; error.value = ''; notice.value = '' }
async function setEnabled(app: App) {
  busy.value = app.id; error.value = ''
  try { state.value = await api<State>(`/api/space/cli-apps/apps/${encodeURIComponent(app.id)}/enabled`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !app.enabled }) }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '更新失败' }
  finally { busy.value = '' }
}
async function install() {
  const entry = selected.value
  if (!entry || !admin.value) return
  busy.value = entry.id; error.value = ''; notice.value = ''; installLog.value = ''
  try {
    const response = await fetch(scopedUrl(`/api/space/cli-apps/catalog/${encodeURIComponent(entry.id)}/install`), { method: 'POST', credentials: 'include' })
    const body = await response.json().catch(() => ({})) as State & { detail?: string | { message?: string; log?: string } }
    if (!response.ok) {
      const detail = body.detail
      const failure = new Error(typeof detail === 'string' ? detail : detail?.message || `HTTP ${response.status}`) as Error & { log?: string }
      failure.log = typeof detail === 'object' ? detail?.log : ''
      throw failure
    }
    state.value = body
    installLog.value = body.log || ''
    entry.installed = true
    entries.value = entries.value.map(item => item.id === entry.id ? { ...item, installed: true } : item)
    notice.value = '安装完成'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '安装失败'; installLog.value = (cause as { log?: string })?.log || '' }
  finally { busy.value = '' }
}
async function uninstall(app: App) {
  if (!admin.value || !confirm(`从服务器卸载“${app.display_name}”？`)) return
  busy.value = app.id; error.value = ''; notice.value = ''
  try { state.value = await api<State>(`/api/space/cli-apps/apps/${encodeURIComponent(app.id)}`, { method: 'DELETE' }); notice.value = '已卸载' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '卸载失败' }
  finally { busy.value = '' }
}
</script>

<template>
  <main class="feature-page cli-apps-page">
    <nav class="cli-page-bar" aria-label="位置"><div class="cli-crumb-wrap"><button type="button" class="cli-crumb" aria-haspopup="menu" :aria-expanded="cliMenuOpen" @click.stop="cliMenuOpen = !cliMenuOpen" @keydown.esc="cliMenuOpen = false"><span aria-hidden="true">▣</span>CLI 应用</button><template v-if="cliMenuOpen"><div class="cli-menu-dismiss" @click="cliMenuOpen = false"></div><div class="cli-resource-menu" role="menu" aria-label="个性化"><p>个性化</p><RouterLink role="menuitem" to="/personalization" @click="cliMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" to="/agents" @click="cliMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" to="/space/personas" @click="cliMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" to="/space/skills" @click="cliMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" to="/space/mcp" @click="cliMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" class="is-active" to="/space/cli-apps" @click="cliMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" to="/memory" @click="cliMenuOpen = false">记忆</RouterLink></div></template></div><span>你可用 {{ usable }} 个</span><span class="legacy-sr-only" aria-hidden="true">{{ usable }} 个可用</span></nav>
    <div class="cli-page-content">
    <header class="cli-apps-heading"><div><h1>CLI 应用</h1><p>来自 CLI-Anything 目录的命令行工具。启用后，对话智能体可以直接调用。</p></div><span>{{ usable }} 个可用</span></header>
    <div class="cli-tabs"><button :class="{ active: tab === 'installed' }" @click="tab = 'installed'">已安装 <small>{{ state?.apps.length || 0 }}</small></button><button :class="{ active: tab === 'store' }" @click="tab = 'store'">商店</button></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <template v-if="tab === 'installed'">
      <p v-if="initialLoading" class="cli-loading" role="status">加载中…</p>
      <div v-else-if="!state?.apps.length" class="cli-empty"><LegacyIcon name="terminal" :size="22" /><h2>还没有安装 CLI 应用</h2><p>{{ admin ? '浏览商店进行安装。安装会在本服务器上运行应用自带的安装程序，因此属于管理员操作。' : '这些由管理员安装，再分配给各账号。可以先在商店里看看，然后按名字向管理员申请。' }}</p><button @click="tab = 'store'">浏览商店</button></div>
      <template v-else>
        <p v-if="state?.access.exec_denied" class="cli-banner warn">当前账号无代码执行权限，因此对话智能体无法使用任何 CLI 应用，包括下方已列出的应用。</p>
        <ul class="cli-installed-list"><li v-for="app in state?.apps || []" :key="app.id"><CliBrandIcon :id="app.id" :name="app.display_name" /><div class="cli-app-copy"><div class="cli-app-title"><strong>{{ app.display_name }}</strong><code>{{ app.tool_name }}</code><span class="cli-chip" :class="trustTone(app.trust)"><LegacyIcon v-if="app.trust === 'first-party'" name="shieldCheck" :size="9" />{{ trustLabel(app.trust, Boolean(app.pin)) }}</span><span v-if="!app.in_catalog" class="cli-chip warn">已从目录移除</span></div><p>{{ app.description }}</p><small>{{ app.installed_at ? `安装于 ${formatDay(app.installed_at)}` : '' }}{{ app.pin ? ` · ${app.pin.slice(0, 12)}` : '' }}</small><p v-if="!app.granted">🔒 尚未分配给当前账号，需要管理员授权后才能使用。</p></div><div class="cli-app-actions"><button v-if="app.granted" type="button" role="switch" :aria-checked="app.enabled" :aria-label="app.enabled ? '开启' : '关闭'" class="cli-switch" :class="{ on: app.enabled }" :disabled="busy === app.id" @click="setEnabled(app)"><span /></button><button v-if="admin" class="cli-icon-button" aria-label="卸载" title="卸载" :disabled="busy === app.id" @click="uninstall(app)"><LegacyIcon name="close" :size="14" /></button></div></li></ul>
        <p class="cli-storage-note">安装于 <code>data/cli-apps</code>，并以只读方式挂载到运行沙箱。</p><p class="cli-trademark">产品名称和徽标均为其各自所有者的商标，仅用于识别。</p>
      </template>
    </template>
    <template v-else-if="selected">
      <section class="cli-entry-detail"><button class="cli-back" @click="selected = null"><LegacyIcon name="chevronLeft" :size="15" />返回商店</button><div class="cli-entry-hero"><CliBrandIcon :id="selected.id" :name="selected.display_name" size="lg" /><div><div class="cli-app-title"><h2>{{ selected.display_name }}</h2><span v-if="selected.installed" class="cli-chip ok">✓ 已安装</span></div><p>{{ selected.description }}</p><div class="cli-entry-chips"><span class="cli-chip">{{ selected.category }}</span><span v-if="selected.runtime" class="cli-chip">{{ selected.runtime }}</span><span class="cli-chip" :class="trustTone(selected.trust)"><LegacyIcon v-if="selected.trust === 'first-party'" name="shieldCheck" :size="9" />{{ trustLabel(selected.trust, selected.pinned) }}</span></div></div></div>
        <div v-if="selected.requires" class="cli-field"><h3>运行要求</h3><p>{{ selected.requires }}</p></div><div v-if="selected.install_notes" class="cli-field"><h3>说明</h3><p>{{ selected.install_notes }}</p></div><div v-if="selected.installable" class="cli-field"><h3>安装内容</h3><code>{{ selected.install_target }}</code><p v-if="!selected.pinned" class="warn">安装会解析为该来源当前发布的内容，并未固定到经过审核的版本。</p></div><div v-if="selected.installable" class="cli-field"><h3>对话中的工具名称</h3><code>cli_{{ selected.id }}</code></div>
        <div class="cli-entry-links"><a v-if="selected.homepage" :href="selected.homepage" target="_blank" rel="noopener noreferrer">官方网站 ↗</a><a v-if="selected.source_url" :href="selected.source_url" target="_blank" rel="noopener noreferrer">来源 ↗</a></div>
        <div v-if="!selected.installable" class="cli-banner warn"><strong>当前环境不可安装。</strong> {{ selected.unsupported_reason }}</div><div v-else-if="!admin" class="cli-banner">只有管理员可以安装。安装后，管理员可以将其分配给你的账号。</div><div v-else class="cli-install-panel"><p v-if="error" class="error" role="alert">{{ error }}</p><div><button class="primary" :disabled="busy === selected.id" @click="install"><LegacyIcon :name="selected.installed ? 'history' : 'plus'" :size="14" />{{ busy === selected.id ? '正在安装…' : selected.installed ? '重新安装' : '安装' }}</button><span>{{ busy === selected.id ? '可能需要几分钟，将创建全新运行环境。' : '以应用用户身份在此服务器上运行。' }}</span></div><details v-if="installLog"><summary>安装输出</summary><pre>{{ installLog }}</pre></details></div>
      </section>
    </template>
    <template v-else>
      <p v-if="!admin" class="cli-banner">安装会在本服务器上运行该应用自带的安装程序，因此属于管理员操作。你可以在此浏览，并按名字向管理员申请。</p>
      <div class="cli-catalog-search"><LegacyIcon name="search" :size="14" /><input v-model="search" type="search" aria-label="搜索应用" placeholder="搜索 CLI 应用…" spellcheck="false"></div>
      <div class="cli-filter-chips"><button :class="{ active: !category }" @click="category = ''">全部</button><button v-for="([name, count]) in categoryChips" :key="name" :class="{ active: category === name }" @click="category = category === name ? '' : name">{{ name }} <small>{{ count }}</small></button><span /><button class="is-muted" :class="{ active: showAll }" @click="showAll = !showAll">包含无法安装的</button></div>
      <p v-if="loading" class="cli-loading">加载中…</p><div v-else-if="!entries.length" class="cli-empty"><LegacyIcon name="terminal" :size="22" /><h2>没有匹配项</h2><p>尝试其他搜索词或清除筛选。</p></div>
      <template v-else><ul class="cli-catalog-grid"><li v-for="entry in entries" :key="entry.id" role="button" tabindex="0" :aria-label="`查看详情：${entry.display_name}`" @click="openEntry(entry)" @keydown.enter="openEntry(entry)" @keydown.space.prevent="openEntry(entry)"><div class="cli-catalog-main"><CliBrandIcon :id="entry.id" :name="entry.display_name" /><div class="cli-app-copy"><div class="cli-app-title"><strong>{{ entry.display_name }}</strong><span v-if="entry.installed" class="cli-chip ok">✓ 已安装</span><span v-if="entry.installable === false" class="cli-chip warn">当前环境不可用</span></div><p>{{ entry.description }}</p></div></div><div class="cli-entry-chips"><span class="cli-chip">{{ entry.category }}</span><span class="cli-chip" :class="trustTone(entry.trust)"><LegacyIcon v-if="entry.trust === 'first-party'" name="shieldCheck" :size="9" />{{ trustLabel(entry.trust, entry.pinned) }}</span></div></li></ul><div class="cli-catalog-count"><span>{{ entries.length }} / {{ total }} 个应用</span><button v-if="cursor" :disabled="loading" @click="loadCatalog(true)">加载更多</button></div></template>
    </template>
    </div>
  </main>
</template>
