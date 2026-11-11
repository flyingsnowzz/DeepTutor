<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api, post } from '../api'
import LegacyIcon from '../components/LegacyIcon.vue'
import McpBrandIcon from '../components/McpBrandIcon.vue'

interface Config { type?: 'sse' | 'streamableHttp' | null; url: string; headers?: Record<string, string>; tool_timeout?: number; enabled_tools?: string[]; enabled?: boolean; auth?: '' | 'oauth'; catalog_entry?: string; allow_private_network?: boolean }
interface CatalogField { key: string; label_i18n: Record<string, string>; secret: boolean; required: boolean; placeholder: string }
interface Entry { id: string; display_name: string; description_i18n: Record<string, string>; category: string; tier: string; transport: string; self_service: boolean; installed: boolean; installed_as: string[]; fields: CatalogField[]; homepage?: string; docs_url?: string; requires_i18n?: Record<string, string>; trust?: string }
interface McpState { servers: Record<string, Config>; status: Record<string, unknown>; configured_secrets: Record<string, string[]>; oauth: Record<string, { authorized: boolean }>; rejected: { name: string; reason: string }[]; deployment: { servers: string[] }; limits: { max_servers: number } }
const state = ref<McpState | null>(null)
const entries = ref<Entry[]>([])
const categories = ref<Record<string, number>>({})
const cursor = ref('')
const total = ref(0)
const tab = ref<'installed' | 'store'>('installed')
const query = ref('')
const category = ref('')
const tier = ref('')
const editing = ref(false)
const originalName = ref('')
const name = ref('')
const url = ref('')
const transport = ref<'' | 'sse' | 'streamableHttp'>('')
const auth = ref<'' | 'oauth'>('')
const enabled = ref(true)
const timeout = ref(30)
const headers = ref('')
const tools = ref('*')
const allowPrivateNetwork = ref(false)
const selected = ref<Entry | null>(null)
const installName = ref('')
const secretValues = ref<Record<string, string>>({})
const busy = ref(false)
const loading = ref(false)
const initialLoading = ref(true)
const mcpMenuOpen = ref(false)
const error = ref('')
const notice = ref('')
const testResult = ref('')
const testTools = ref<{ name: string; description?: string }[]>([])
let catalogVersion = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const serverNames = computed(() => Object.keys(state.value?.servers || {}))
const atCapacity = computed(() => Boolean(state.value?.limits.max_servers && serverNames.value.length >= state.value.limits.max_servers))
const localized = (value?: Record<string, string>) => value?.zh || value?.en || ''
const missingRequired = computed(() => (selected.value?.fields || []).filter(field => field.required && !String(secretValues.value[field.key] || '').trim()))
const categoryLabels: Record<string, string> = { search: '搜索', docs: '文档', code: '代码', data: '数据', browser: '浏览器', science: '科研', maps: '地图', business: '业务', ai: 'AI', utility: '实用工具' }
const tierLabels: Record<string, string> = { curated: '精选', registry: '社区登记' }
const categoryChips = computed(() => Object.entries(categories.value).filter(([, count]) => count > 0))
const installTest = ref<{ ok: boolean; tools?: unknown[]; error?: string } | null>(null)
function categoryLabel(value: string) { return categoryLabels[value] || value }
function tierLabel(value: string) { return tierLabels[value] || value }
function entryInstalledNames(entry: Entry) {
  return Object.entries(state.value?.servers || {}).filter(([serverName, config]) => config.catalog_entry === entry.id || (!config.catalog_entry && serverName === entry.id)).map(([serverName]) => serverName).sort()
}
function selectedInstalledNames() { return selected.value ? entryInstalledNames(selected.value) : [] }
async function load() {
  initialLoading.value = true
  try { state.value = await api<McpState>('/api/space/mcp/servers') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'MCP 服务加载失败' }
  finally { initialLoading.value = false }
}
async function loadCatalog(more = false) {
  const version = ++catalogVersion
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ q: query.value.trim(), category: category.value, tier: tier.value, limit: '12' })
    if (more && cursor.value) params.set('cursor', cursor.value)
    const result = await api<{ entries: Entry[]; categories: Record<string, number>; next_cursor: string; total: number }>(`/api/space/mcp/catalog?${params}`)
    if (version !== catalogVersion) return
    entries.value = more ? [...entries.value, ...result.entries] : result.entries
    categories.value = result.categories
    cursor.value = result.next_cursor
    total.value = result.total
  } catch (cause) { if (version === catalogVersion) error.value = cause instanceof Error ? cause.message : 'MCP 目录加载失败' }
  finally { if (version === catalogVersion) loading.value = false }
}
onMounted(load)
onUnmounted(() => { catalogVersion++; if (searchTimer) clearTimeout(searchTimer) })
watch([tab, category, tier], () => { if (tab.value === 'store') void loadCatalog() })
watch(query, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (tab.value === 'store') void loadCatalog() }, 250) })
function resetTest() { testResult.value = ''; testTools.value = [] }
function startAdd() {
  originalName.value = ''
  name.value = ''
  url.value = ''
  transport.value = ''
  auth.value = ''
  enabled.value = true
  timeout.value = 30
  headers.value = ''
  tools.value = '*'
  allowPrivateNetwork.value = false
  editing.value = true
  resetTest()
}
function startEdit(serverName: string) {
  const cfg = state.value?.servers[serverName]
  if (!cfg) return
  originalName.value = serverName
  name.value = serverName
  url.value = cfg.url
  transport.value = cfg.type || ''
  auth.value = cfg.auth || ''
  enabled.value = cfg.enabled !== false
  timeout.value = cfg.tool_timeout || 30
  allowPrivateNetwork.value = Boolean(cfg.allow_private_network)
  headers.value = Object.entries(cfg.headers || {}).filter(([, value]) => !value.includes('${secret:')).map(([key, value]) => `${key}: ${value}`).join('\n')
  tools.value = (cfg.enabled_tools || ['*']).join('\n')
  editing.value = true
  resetTest()
}
function config(): Config {
  // Deleted plain headers must stay deleted; only server-side secret references
  // are retained because their raw values intentionally never reach the browser.
  const headerMap: Record<string, string> = Object.fromEntries(Object.entries(originalName.value ? state.value?.servers[originalName.value]?.headers || {} : {}).filter(([, value]) => value.includes('${secret:')))
  for (const line of headers.value.split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) headerMap[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { ...(originalName.value ? state.value?.servers[originalName.value] || {} : {}), type: transport.value || null, url: url.value.trim(), headers: headerMap, tool_timeout: timeout.value, enabled_tools: tools.value.split('\n').map(item => item.trim()).filter(Boolean), enabled: enabled.value, auth: auth.value, allow_private_network: allowPrivateNetwork.value }
}
function validateName() {
  const target = name.value.trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(target)) return '服务名须以字母或数字开头，仅含字母、数字、连字符或下划线，最长 64 字符。'
  if (target !== originalName.value && serverNames.value.includes(target)) return '同名服务已存在。'
  if (!/^https?:\/\//.test(url.value.trim())) return '请输入有效的 HTTP(S) URL。'
  return ''
}
async function save() {
  const invalid = validateName()
  if (invalid) { error.value = invalid; return }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    state.value = await api<McpState>(`/api/space/mcp/servers/${encodeURIComponent(name.value.trim())}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: config(), secrets: {} }) })
    if (originalName.value && originalName.value !== name.value.trim()) state.value = await api<McpState>(`/api/space/mcp/servers/${encodeURIComponent(originalName.value)}`, { method: 'DELETE' })
    editing.value = false
    notice.value = '服务已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
async function test() {
  if (!/^https?:\/\//.test(url.value.trim())) { error.value = '请先输入有效的 HTTP(S) URL。'; return }
  busy.value = true
  resetTest()
  error.value = ''
  try {
    const result = await post<{ ok: boolean; error?: string; tools?: { name: string; description?: string }[] }>(`/api/space/mcp/servers/${encodeURIComponent(name.value.trim() || '_draft')}/test`, { config: config(), secrets: {} })
    testResult.value = result.ok ? `连接成功，发现 ${result.tools?.length || 0} 个工具` : result.error || '连接失败'
    testTools.value = result.ok ? result.tools || [] : []
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '连接测试失败' }
  finally { busy.value = false }
}
async function remove(serverName: string) {
  if (!confirm(`删除 MCP 服务“${serverName}”？`)) return
  busy.value = true
  error.value = ''
  try { state.value = await api<McpState>(`/api/space/mcp/servers/${encodeURIComponent(serverName)}`, { method: 'DELETE' }); notice.value = '服务已删除' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busy.value = false }
}
async function authorize(serverName: string) {
  busy.value = true
  error.value = ''
  const popup = window.open('', '_blank')
  try {
    const result = await post<{ authorize_url: string }>(`/api/space/mcp/servers/${encodeURIComponent(serverName)}/authorize`, {})
    if (popup) { popup.location.href = result.authorize_url; notice.value = '请在授权窗口完成操作，然后刷新服务状态。' }
    else error.value = '浏览器阻止了授权窗口，请允许弹出窗口后重试。'
  } catch (cause) { popup?.close(); error.value = cause instanceof Error ? cause.message : '授权启动失败' }
  finally { busy.value = false }
}
function selectEntry(entry: Entry) {
  selected.value = entry
  installName.value = entry.installed_as?.[0] || entry.id
  secretValues.value = {}
  installTest.value = null
  error.value = ''
}
async function testInstalled() {
  if (!selected.value) return
  const target = installName.value.trim()
  const cfg = state.value?.servers[target]
  if (!cfg) return
  busy.value = true
  error.value = ''
  installTest.value = null
  try { installTest.value = await post<{ ok: boolean; tools?: unknown[]; error?: string }>(`/api/space/mcp/servers/${encodeURIComponent(target)}/test`, { config: cfg, secrets: {} }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '连接测试失败' }
  finally { busy.value = false }
}
async function install() {
  if (!selected.value || (atCapacity.value && !selected.value.installed)) return
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(installName.value.trim())) { error.value = '请输入有效的账号内服务名。'; return }
  if (missingRequired.value.length) { error.value = `请填写必填字段：${missingRequired.value.map(field => localized(field.label_i18n) || field.key).join('、')}`; return }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const target = installName.value.trim()
    const entry = selected.value
    state.value = await post<McpState>(`/api/space/mcp/catalog/${encodeURIComponent(entry.id)}/install`, { name: target, secrets: secretValues.value })
    selected.value = { ...entry, installed: true, installed_as: entryInstalledNames(entry) }
    entries.value = entries.value.map(item => item.id === entry.id ? { ...item, installed: true, installed_as: entryInstalledNames(entry) } : item)
    installTest.value = null
    const cfg = state.value.servers[target]
    if (cfg) {
      installTest.value = await post<{ ok: boolean; tools?: unknown[]; error?: string }>(`/api/space/mcp/servers/${encodeURIComponent(target)}/test`, { config: cfg, secrets: secretValues.value })
      notice.value = installTest.value.ok ? `服务已加入账号，检测到 ${installTest.value.tools?.length || 0} 个工具` : `服务已加入账号，但连接测试失败：${installTest.value.error || '未知错误'}`
    } else notice.value = '服务已加入账号'
    await loadCatalog()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '安装失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="feature-page mcp-page">
    <nav class="mcp-page-bar" aria-label="位置"><div class="mcp-crumb-wrap"><button type="button" class="mcp-crumb" aria-haspopup="menu" :aria-expanded="mcpMenuOpen" @click.stop="mcpMenuOpen = !mcpMenuOpen" @keydown.esc="mcpMenuOpen = false"><span aria-hidden="true">♧</span>MCP 服务</button><template v-if="mcpMenuOpen"><div class="mcp-menu-dismiss" @click="mcpMenuOpen = false"></div><div class="mcp-resource-menu" role="menu" aria-label="个性化"><p>个性化</p><RouterLink role="menuitem" to="/personalization" @click="mcpMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" to="/agents" @click="mcpMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" to="/space/personas" @click="mcpMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" to="/space/skills" @click="mcpMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" class="is-active" to="/space/mcp" @click="mcpMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" to="/space/cli-apps" @click="mcpMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" to="/memory" @click="mcpMenuOpen = false">记忆</RouterLink></div></template></div><span>已连接 {{ serverNames.length }} / {{ state?.limits.max_servers || '—' }}</span></nav>
    <div class="mcp-page-content"><RouterLink to="/personalization" class="text-button">← 个性化</RouterLink>
    <header class="feature-heading"><div><h1>MCP 服务</h1><p>连接托管服务，将它们的工具带入对话。</p></div><div><span>{{ serverNames.length }} / {{ state?.limits.max_servers || '—' }} 个服务</span><button type="button" @click="load">刷新</button></div></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <section class="mcp-scope-panel"><p>账户资源库：在此管理资源，在设置中将资源分配给 工作区。 <RouterLink to="/settings#workspace">工作区</RouterLink></p></section><div class="cli-tabs"><button :class="{ active: tab === 'installed' }" @click="tab = 'installed'">已安装 <small>{{ serverNames.length }}</small></button><button :class="{ active: tab === 'store' }" @click="tab = 'store'">商店</button></div>
    <template v-if="tab === 'installed'"><p v-if="initialLoading" role="status">加载中…</p><section v-else-if="!serverNames.length" class="mcp-empty"><span aria-hidden="true"><LegacyIcon name="plug" :size="18" /></span><h2>还没有 MCP 服务器</h2><p>添加服务器，把它的工具开放给聊天智能体。先测试连接，再保存。</p></section><div class="reading-list"><article v-for="serverName in serverNames" :key="serverName" class="mcp-server-card"><div><strong>{{ serverName }}</strong><p>{{ state?.servers[serverName]?.url }}</p><small>{{ state?.servers[serverName]?.type || '自动识别' }} · {{ state?.servers[serverName]?.enabled !== false ? '已启用' : '已停用' }} · {{ state?.configured_secrets[serverName]?.length || 0 }} 项凭据已配置</small><p v-if="state?.servers[serverName]?.allow_private_network">已批准此来源使用私网连接（云元数据地址仍禁止）。</p><p v-if="state?.oauth[serverName]">OAuth：{{ state?.oauth[serverName]?.authorized ? '已授权' : '待授权' }}</p></div><div class="partner-actions"><button v-if="state?.oauth[serverName]" :disabled="busy" @click="authorize(serverName)">{{ state?.oauth[serverName]?.authorized ? '重新授权' : '授权' }}</button><button @click="startEdit(serverName)">编辑</button><button :disabled="busy" @click="remove(serverName)">删除</button></div></article></div><div class="mcp-add-actions"><button class="legacy-sr-only" aria-hidden="true" tabindex="-1" @click="startAdd">添加远程服务</button><button class="primary" aria-label="添加远程服务" :disabled="busy || atCapacity" @click="startAdd">＋ 通过 URL 添加服务</button><button @click="tab = 'store'">浏览商店</button></div><p v-if="atCapacity" class="muted">已达到当前账号服务数量上限。</p>
      <section v-if="state?.rejected?.length"><h2>未连接的配置</h2><article v-for="item in state?.rejected || []" :key="item.name" class="reading-row"><span>{{ item.name }}：{{ item.reason }}</span><button @click="remove(item.name)">删除</button></article></section><p class="mcp-storage-note">保存于 <code>data/system/user-mcp/&lt;your account&gt;.json</code></p><section v-if="state?.deployment?.servers?.length"><h2>部署提供的服务</h2><p class="muted">这些服务由管理员管理。</p><div v-for="serverName in state?.deployment?.servers || []" :key="serverName" class="reading-row">{{ serverName }}</div></section>
      <section v-if="editing" class="reading-create mcp-editor"><h2>{{ originalName ? '编辑服务' : '添加远程服务' }}</h2><form class="settings-form" @submit.prevent="save"><label>名称<input v-model="name" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}"></label><label>传输方式<select v-model="transport"><option value="">自动识别</option><option value="streamableHttp">Streamable HTTP</option><option value="sse">SSE</option></select></label><label>服务 URL<input v-model="url" type="url" required placeholder="https://example.com/mcp"></label><label>认证方式<select v-model="auth"><option value="">无或静态凭据</option><option value="oauth">OAuth</option></select></label><label class="settings-check"><input v-model="allowPrivateNetwork" type="checkbox">批准此来源使用私网连接</label><p class="muted">仅允许此协议、主机和端口连接 Docker 或局域网地址；云元数据地址始终禁止。</p><label>请求头（每行 Name: Value）<textarea v-model="headers" rows="3" placeholder="Authorization: Bearer ..." /></label><p class="muted">已保存的密钥引用会保留；删除普通请求头行会将其移除。</p><label>工具白名单（每行一个，* 为全部）<textarea v-model="tools" rows="2" /></label><label>工具超时（秒）<input v-model.number="timeout" type="number" min="1" max="600"></label><label class="settings-check"><input v-model="enabled" type="checkbox">启用</label><p v-if="testResult" role="status">{{ testResult }}</p><ul v-if="testTools.length"><li v-for="tool in testTools" :key="tool.name"><code>{{ tool.name }}</code><span v-if="tool.description"> — {{ tool.description }}</span></li></ul><div class="partner-actions"><button type="button" :disabled="busy" @click="test">测试连接</button><button type="button" @click="editing = false">取消</button><button class="primary" :disabled="busy">保存</button></div></form></section>
    </template>
    <template v-else-if="selected">
      <section class="mcp-entry-detail">
        <button type="button" class="mcp-back" @click="selected = null"><LegacyIcon name="chevronLeft" :size="15" />返回商店</button>
        <div class="mcp-entry-hero"><McpBrandIcon :id="selected.id" :name="selected.display_name" size="lg" /><div><div class="mcp-entry-title"><h2>{{ selected.display_name }}</h2><span v-if="selectedInstalledNames().length" class="mcp-installed-badge">✓ 已安装</span></div><p>{{ localized(selected.description_i18n) }}</p><div class="mcp-entry-chips"><span>{{ categoryLabel(selected.category) }}</span><span>{{ tierLabel(selected.tier) }}</span><span>{{ selected.transport }}</span><span v-if="selected.trust && selected.trust !== 'verified'" class="is-warning"><LegacyIcon name="shieldAlert" :size="9" />未验证</span></div></div></div>
        <div v-if="localized(selected.requires_i18n)" class="mcp-entry-requirements"><h3>运行要求</h3><p>{{ localized(selected.requires_i18n) }}</p></div>
        <div v-if="selected.docs_url || selected.homepage" class="mcp-entry-links"><a v-if="selected.docs_url" :href="selected.docs_url" target="_blank" rel="noopener noreferrer"><LegacyIcon name="bookOpen" :size="13" />文档</a><a v-if="selected.homepage" :href="selected.homepage" target="_blank" rel="noopener noreferrer"><LegacyIcon name="cornerUpRight" :size="13" />官方网站</a></div>
        <div class="mcp-install-panel"><form class="settings-form" @submit.prevent="install"><label>安装为<input v-model="installName" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}" spellcheck="false" autocomplete="off"></label><label v-for="field in selected.fields" :key="field.key">{{ localized(field.label_i18n) || field.key }}<small v-if="!field.required">可选</small><input v-model="secretValues[field.key]" :type="field.secret ? 'password' : 'text'" :required="field.required" :placeholder="field.placeholder" autocomplete="off" spellcheck="false"></label><p v-if="selected.fields.length" class="muted">凭据独立保存，不会随服务器配置返回此页面。</p><p v-if="atCapacity && !selectedInstalledNames().length" class="mcp-warning">已达到当前账号服务数量上限。</p><div v-if="installTest" class="mcp-probe" :class="{ ok: installTest.ok, failed: !installTest.ok }">{{ installTest.ok ? `连接成功，检测到 ${installTest.tools?.length || 0} 个工具` : `连接失败：${installTest.error || '未知错误'}` }}</div><div class="mcp-install-actions"><button v-if="selectedInstalledNames().length" type="button" :disabled="busy" @click="testInstalled">测试连接</button><button class="primary" :disabled="busy || !selected.self_service || (atCapacity && !selectedInstalledNames().length) || missingRequired.length > 0"><LegacyIcon :name="selectedInstalledNames().length ? 'refreshCw' : 'fileDown'" :size="14" />{{ selectedInstalledNames().length ? '重新安装' : '安装' }}</button></div><p v-if="missingRequired.length" class="muted">请填写 {{ missingRequired.map(field => localized(field.label_i18n) || field.key).join('、') }} 后继续。</p></form></div>
      </section>
    </template>
    <template v-else>
      <div class="mcp-store"><div class="mcp-search"><LegacyIcon name="search" :size="14" /><input v-model="query" type="search" aria-label="搜索服务" placeholder="搜索 MCP 服务…" spellcheck="false"></div>
      <div class="mcp-filter-chips"><button type="button" :class="{ active: !category }" @click="category = ''">全部</button><button v-for="([key, count]) in categoryChips" :key="key" type="button" :class="{ active: category === key }" @click="category = category === key ? '' : key">{{ categoryLabel(key) }} <span>{{ count }}</span></button><i></i><button type="button" class="is-muted" :class="{ active: tier === 'curated' }" @click="tier = tier === 'curated' ? '' : 'curated'">精选</button><button type="button" class="is-muted" :class="{ active: tier === 'registry' }" @click="tier = tier === 'registry' ? '' : 'registry'">社区登记</button></div>
      <p v-if="loading" class="mcp-store-loading">加载中…</p><div v-else-if="!entries.length" class="mcp-store-empty"><span><LegacyIcon name="plug" :size="18" /></span><h2>{{ query || category || tier ? '没有匹配服务。' : '商店为空' }}</h2><p v-if="!(query || category || tier)">此部署尚无可安装的 MCP 服务。仍可通过 URL 添加。</p></div>
      <template v-else><ul class="mcp-store-grid"><li v-for="entry in entries" :key="entry.id" class="mcp-store-card" role="button" tabindex="0" :aria-label="`查看详情：${entry.display_name}`" @click="selectEntry(entry)" @keydown.enter="selectEntry(entry)" @keydown.space.prevent="selectEntry(entry)"><div class="mcp-store-card-main"><McpBrandIcon :id="entry.id" :name="entry.display_name" /><div><div class="mcp-entry-title"><strong>{{ entry.display_name }}</strong><span v-if="entryInstalledNames(entry).length" class="mcp-installed-badge">✓ 已安装</span></div><p>{{ localized(entry.description_i18n) }}</p></div></div><div class="mcp-entry-chips"><span>{{ categoryLabel(entry.category) }}</span><span v-if="entry.tier === 'registry'">社区登记</span><span v-if="entry.trust && entry.trust !== 'verified'" class="is-warning"><LegacyIcon name="shieldAlert" :size="9" />未验证</span><span v-if="entry.fields.length">需要凭据</span></div></li></ul><div class="mcp-store-count"><span>{{ entries.length }} / {{ total }} 个服务</span><button v-if="cursor" :disabled="loading" @click="loadCatalog(true)">加载更多</button></div><p class="mcp-trademark">产品名称和徽标均为其各自所有者的商标，仅用于识别。</p></template>
      </div>
    </template>
    </div>
  </main>
</template>
