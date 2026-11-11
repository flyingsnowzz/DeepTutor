<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { api, post } from '../api'
import { sessionNavigationPath } from '../sessionNavigation'
import LegacyIcon from '../components/LegacyIcon.vue'
import { buildSelectGroups, filterRefsByScope, isFileSystemAccessSupported, parseSessions, pickAndScan, scanDirectory, selectionUnit } from '../imports/chat-import'
import { deleteAgent, ensureReadPermission, getAgents, newAgentId, saveAgent, type ImportAgent } from '../imports/chat-import/agent-store'
import { importChatHistoryInBatches } from '../imports/importApi'
import type { AgentScope, ImportSource, ScanResult, SelectGroup, SessionRef } from '../imports/chat-import/types'

interface Backend { kind: string; display_name: string; available: boolean; version: string; detail: string }
interface Connection { name: string; agent_kind: string; cwd: string; description?: string }
interface Session { id?: string; session_id?: string; title: string; last_message?: string; created_at: number; updated_at: number; preferences?: { import?: { source: ImportSource; source_cwd?: string; agent_id?: string }; workspace_id?: string; workspace_mode?: string; mastery_path_id?: string; reading_workspace_id?: string; book_id?: string; book_page_id?: string; note_document_id?: string } }
const router = useRouter()
const backends = ref<Backend[]>([])
const connections = ref<Connection[]>([])
const sessions = ref<Session[]>([])
const registry = ref<ImportAgent[]>([])
const selectedKey = ref('')
const query = ref('')
const loading = ref(true)
const error = ref('')
const notice = ref('')
const agentsMenuOpen = ref(false)
const busy = ref(false)
const wizardOpen = ref(false)
const editingAgent = ref<ImportAgent | null>(null)
const scan = ref<ScanResult | null>(null)
const groups = ref<SelectGroup[]>([])
const selectedKeys = ref<Set<string>>(new Set())
const agentName = ref('')
const progress = ref({ done: 0, total: 0, imported: 0, skipped: 0 })
const showForm = ref(false)
const connectionError = ref('')
const openMenu = ref('')
const renamingId = ref('')
const renameDraft = ref('')
const renamingSessionId = ref('')
const sessionRenameDraft = ref('')
const name = ref('')
const kind = ref('')
const cwd = ref('')
const available = computed(() => backends.value.filter(item => item.available))
const unit = computed(() => scan.value ? selectionUnit(scan.value.source) : 'projects')
const cards = computed(() => registry.value.map(agent => {
  const owned = sessions.value.filter(session => session.preferences?.import?.agent_id === agent.id || (!session.preferences?.import?.agent_id && session.preferences?.import?.source === agent.source && scopeContains(agent.scope, session)))
  return { agent, sessions: owned, latest: Math.max(0, ...owned.map(session => session.updated_at)) }
}).sort((a, b) => (b.agent.lastSyncAt || b.agent.createdAt) - (a.agent.lastSyncAt || a.agent.createdAt)))
const visibleSessions = computed(() => {
  const selected = cards.value.find(card => card.agent.id === selectedKey.value)
  const rows = selected ? selected.sessions : []
  const needle = query.value.trim().toLowerCase()
  return rows.filter(session => !needle || `${session.title} ${session.last_message || ''}`.toLowerCase().includes(needle)).sort((a, b) => b.updated_at - a.updated_at)
})
function scopeContains(scope: AgentScope, session: Session) {
  if (scope.kind === 'all') return true
  const meta = session.preferences?.import
  if (scope.kind === 'projects') return scope.cwds.includes(meta?.source_cwd || '')
  const date = new Date(session.created_at * 1000).toISOString().slice(0, 10)
  return scope.days.includes(date)
}
async function load() {
  loading.value = true
  error.value = ''
  const [backendResult, connectionResult, importedResult, agentResult] = await Promise.allSettled([api<{ backends: Backend[] }>('/api/subagents/detect'), api<{ connections: Connection[] }>('/api/subagents/connections'), api<{ sessions: Session[] }>('/api/imports/chat-history?limit=200&offset=0'), getAgents()])
  if (backendResult.status === 'fulfilled') backends.value = backendResult.value.backends
  if (connectionResult.status === 'fulfilled') connections.value = connectionResult.value.connections
  if (importedResult.status === 'fulfilled') sessions.value = importedResult.value.sessions
  if (agentResult.status === 'fulfilled') registry.value = agentResult.value
  if (!selectedKey.value && registry.value[0]) selectedKey.value = registry.value[0].id
  loading.value = false
}
onMounted(() => { void load(); document.addEventListener('click', closeMenu) })
onUnmounted(() => document.removeEventListener('click', closeMenu))
function closeMenu() { openMenu.value = '' }
function scopeSummary(agent: ImportAgent) { return agent.scope.kind === 'projects' ? `${agent.scope.cwds.length} 个项目` : agent.scope.kind === 'dates' ? `${agent.scope.days.length} 天` : '全部对话' }
function startRename(agent: ImportAgent) { openMenu.value = ''; renamingId.value = agent.id; renameDraft.value = agent.name }
async function commitRename(agent: ImportAgent) { if (renamingId.value !== agent.id) return; const next = renameDraft.value.trim(); renamingId.value = ''; if (!next || next === agent.name) return; await saveAgent({ ...agent, name: next }); await load() }
function startAdd() {
  if (!isFileSystemAccessSupported()) { error.value = '当前浏览器不支持目录访问，请使用桌面版 Chrome 或 Edge。'; return }
  editingAgent.value = null
  agentName.value = ''
  scan.value = null
  groups.value = []
  selectedKeys.value = new Set()
  progress.value = { done: 0, total: 0, imported: 0, skipped: 0 }
  wizardOpen.value = true
}
async function chooseFolder() {
  busy.value = true
  error.value = ''
  try {
    scan.value = await pickAndScan()
    groups.value = buildSelectGroups(scan.value)
    selectedKeys.value = new Set(groups.value.map(group => group.key))
    if (!agentName.value) agentName.value = scan.value.handle.name
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '选择目录失败' }
  finally { busy.value = false }
}
async function openScope(agent: ImportAgent) {
  if (!(await ensureReadPermission(toRaw(agent.handle)))) { error.value = '没有读取该目录的权限，请重新选择。'; return }
  editingAgent.value = agent
  agentName.value = agent.name
  scan.value = await scanDirectory(toRaw(agent.handle))
  groups.value = buildSelectGroups(scan.value)
  selectedKeys.value = new Set(agent.scope.kind === 'all' ? groups.value.map(group => group.key) : agent.scope.kind === 'projects' ? agent.scope.cwds : agent.scope.days)
  wizardOpen.value = true
}
function toggleGroup(key: string) {
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}
function selectedRefs(): SessionRef[] { return groups.value.filter(group => selectedKeys.value.has(group.key)).flatMap(group => group.sessions) }
function selectedScope(): AgentScope {
  if (!scan.value) return { kind: 'all' }
  if (selectedKeys.value.size === groups.value.length) return { kind: 'all' }
  return selectionUnit(scan.value.source) === 'projects' ? { kind: 'projects', cwds: groups.value.filter(group => selectedKeys.value.has(group.key)).map(group => group.key) } : { kind: 'dates', days: groups.value.filter(group => selectedKeys.value.has(group.key)).map(group => group.key) }
}
async function confirmImport() {
  if (!scan.value || !agentName.value.trim() || !selectedKeys.value.size) return
  busy.value = true
  error.value = ''
  try {
    const parsed = await parseSessions(scan.value.source, selectedRefs(), (done, total) => { progress.value = { ...progress.value, done, total } })
    if (!parsed.length) throw new Error('所选文件中没有可导入的对话')
    const id = editingAgent.value?.id || newAgentId(scan.value.source)
    const result = await importChatHistoryInBatches(scan.value.source, parsed, { id, name: agentName.value.trim() }, (done, total) => { progress.value = { ...progress.value, done, total } })
    const now = Date.now()
    const agent: ImportAgent = { id, name: agentName.value.trim(), source: scan.value.source, folderName: scan.value.handle.name, handle: toRaw(scan.value.handle), scope: selectedScope(), createdAt: editingAgent.value?.createdAt || now, lastSyncAt: now }
    await saveAgent(agent)
    selectedKey.value = id
    wizardOpen.value = false
    editingAgent.value = null
    progress.value = { ...progress.value, imported: result.imported, skipped: result.skipped }
    notice.value = `导入 ${result.imported} 段新对话，跳过 ${result.skipped} 段已有对话`
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导入失败' }
  finally { busy.value = false }
}
async function refreshAgent(agent: ImportAgent) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (!(await ensureReadPermission(toRaw(agent.handle)))) throw new Error('没有读取该目录的权限')
    const nextScan = await scanDirectory(toRaw(agent.handle))
    const refs = filterRefsByScope(nextScan.projects.flatMap(project => project.sessions), agent.scope)
    const parsed = await parseSessions(nextScan.source, refs)
    const result = await importChatHistoryInBatches(nextScan.source, parsed, agent)
    await saveAgent({ ...agent, handle: toRaw(agent.handle), lastSyncAt: Date.now() })
    notice.value = result.imported ? `新增 ${result.imported} 段对话` : '已是最新'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '刷新失败' }
  finally { busy.value = false }
}
async function removeAgent(agent: ImportAgent) {
  const owned = cards.value.find(card => card.agent.id === agent.id)?.sessions || []
  if (!confirm(`删除“${agent.name}”及其 ${owned.length} 段导入对话？此操作无法撤销。`)) return
  await Promise.allSettled(owned.map(session => api(`/api/sessions/${encodeURIComponent(session.session_id || session.id || '')}`, { method: 'DELETE' })))
  await deleteAgent(agent.id)
  if (selectedKey.value === agent.id) selectedKey.value = ''
  await load()
}

function startSessionRename(session: Session) {
  const id = session.session_id || session.id
  if (!id) return
  renamingSessionId.value = id
  sessionRenameDraft.value = session.title
}
async function commitSessionRename(session: Session) {
  const id = session.session_id || session.id
  if (!id || renamingSessionId.value !== id) return
  const title = sessionRenameDraft.value.trim()
  renamingSessionId.value = ''
  if (!title || title === session.title) return
  await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
  await load()
}
function cancelSessionRename() { renamingSessionId.value = ''; sessionRenameDraft.value = '' }
async function removeSession(session: Session) {
  const id = session.session_id || session.id
  if (!id || !confirm('永久删除这段对话及其导师线程？此操作无法撤销。')) return
  await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await load()
}
function openSession(session: Session) {
  const id = session.session_id || session.id
  if (id) void router.push(sessionNavigationPath({ id, preferences: session.preferences as any }))
}
function startConnection() { name.value = ''; kind.value = available.value[0]?.kind || ''; cwd.value = ''; connectionError.value = ''; showForm.value = true }
async function connect() {
  if (!name.value.trim() || !kind.value) return
  if (connections.value.some(item => item.name === name.value.trim())) { connectionError.value = '已存在同名连接。'; return }
  busy.value = true
  connectionError.value = ''
  try { await post('/api/subagents/connections', { name: name.value.trim(), agent_kind: kind.value, ...(kind.value === 'hermes_remote' ? {} : { cwd: cwd.value.trim() }) }); showForm.value = false; await load(); notice.value = '智能体已连接' }
  catch (cause) { connectionError.value = cause instanceof Error ? cause.message : '连接失败' }
  finally { busy.value = false }
}
async function disconnect(item: Connection) {
  if (!confirm(`断开“${item.name}”？本机配置不会被删除。`)) return
  try { await api(`/api/subagents/connections/${encodeURIComponent(item.name)}`, { method: 'DELETE' }); await load(); notice.value = '连接已断开' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '断开失败' }
}
</script>

<template>
  <main class="feature-page agents-page">
    <nav class="agents-page-bar" aria-label="位置"><div class="agents-crumb-wrap"><button type="button" class="agents-crumb" aria-haspopup="menu" :aria-expanded="agentsMenuOpen" @click.stop="agentsMenuOpen = !agentsMenuOpen" @keydown.esc="agentsMenuOpen = false"><span aria-hidden="true"><LegacyIcon name="agents" :size="14" /></span>子智能体</button><template v-if="agentsMenuOpen"><div class="agents-menu-dismiss" @click="agentsMenuOpen = false"></div><div class="agents-resource-menu" role="menu" aria-label="个性化"><p>个性化</p><RouterLink role="menuitem" to="/personalization" @click="agentsMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" class="is-active" to="/agents" @click="agentsMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" to="/space/personas" @click="agentsMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" to="/space/skills" @click="agentsMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" to="/space/mcp" @click="agentsMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" to="/space/cli-apps" @click="agentsMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" to="/memory" @click="agentsMenuOpen = false">记忆</RouterLink></div></template></div><button v-if="available.length" class="agents-bar-action" @click="startConnection"><LegacyIcon name="plus" :size="14" />连接智能体</button></nav>
    <div class="agents-page-content"><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <section class="agents-connected"><header class="agents-section-heading"><div><h1>连接的智能体</h1><p>把本机智能体或已配置的远程 Hermes 网关接进来，在对话中选中后直接向它提问——运行过程会实时展示。</p></div><button v-if="available.length" class="primary" @click="startConnection"><LegacyIcon name="plus" :size="14" />连接智能体</button></header>
      <p v-if="loading" class="muted" role="status">检测可用智能体…</p>
      <div v-else-if="!available.length" class="agents-empty">未检测到可用的本机智能体或已配置的远程 Hermes 网关。安装并登录受支持的 CLI 或配置远程网关，即可连接。</div>
      <div v-else-if="!connections.length" class="agents-empty">尚未连接任何智能体。点击「连接智能体」接入本机智能体或远程 Hermes 网关。</div>
      <div v-else class="agents-card-grid"><article v-for="item in connections" :key="item.name" class="agents-connection-card"><span class="agents-card-icon"><LegacyIcon name="agents" :size="20" /></span><div><strong>{{ item.name }}</strong><p>{{ backends.find(backend => backend.kind === item.agent_kind)?.display_name || item.agent_kind }}<template v-if="item.cwd"> · {{ item.cwd }}</template></p></div><button type="button" class="agents-icon-button danger" aria-label="断开" title="断开" :disabled="busy" @click="disconnect(item)"><LegacyIcon name="close" :size="15" /></button></article></div>
    </section>
    <section class="agents-import"><header class="agents-section-heading"><div><h2>导入的对话</h2><p>导入 ChatGPT 数据，或连接 Claude Code 与 Codex 文件夹。打开任意已导入对话即可继续聊天。</p></div><button v-if="cards.length" class="primary" @click="startAdd"><LegacyIcon name="plus" :size="14" />导入会话</button></header>
      <p v-if="progress.imported || progress.skipped" class="muted">上次导入：{{ progress.imported }} 新增，{{ progress.skipped }} 跳过</p>
      <div v-if="loading" class="agents-empty">正在加载…</div>
      <div v-else-if="!cards.length" class="agents-import-empty"><span class="agents-import-icon"><LegacyIcon name="agents" :size="20" /></span><h3>还没有智能体</h3><p>导入 ChatGPT 数据导出，或添加 Claude Code、Codex 文件夹，然后打开任意对话并在 DeepTutor 中继续。</p><button class="primary" @click="startAdd"><LegacyIcon name="plus" :size="14" />导入对话</button></div>
      <template v-else>
        <div class="agents-card-grid agents-registry-grid"><article v-for="card in cards" :key="card.agent.id" class="agents-registry-card" :class="{ active: selectedKey === card.agent.id }" role="button" tabindex="0" @click="selectedKey = card.agent.id" @keydown.enter="selectedKey = card.agent.id">
          <span class="agents-card-icon"><LegacyIcon name="agents" :size="20" /></span>
          <div class="agents-registry-copy"><input v-if="renamingId === card.agent.id" v-model="renameDraft" @click.stop @keyup.enter="commitRename(card.agent)" @keyup.esc="renamingId = ''" @blur="commitRename(card.agent)"><template v-else><strong>{{ card.agent.name }}</strong><p>{{ card.agent.source }} · {{ scopeSummary(card.agent) }} · {{ card.sessions.length }} 段对话</p><small>{{ card.agent.lastSyncAt ? `同步于 ${new Date(card.agent.lastSyncAt).toLocaleString('zh-CN')}` : '尚未同步' }}</small></template>
          </div>
          <div class="agents-card-actions"><button type="button" class="agents-icon-button" title="刷新历史" aria-label="刷新历史" :disabled="busy" @click.stop="refreshAgent(card.agent)"><LegacyIcon name="history" :size="15" /></button><div class="agents-menu-wrap"><button type="button" class="agents-icon-button" aria-label="更多" :aria-expanded="openMenu === card.agent.id" @click.stop="openMenu = openMenu === card.agent.id ? '' : card.agent.id"><LegacyIcon name="more" :size="16" /></button><div v-if="openMenu === card.agent.id" class="agents-menu" role="menu" @click.stop><button role="menuitem" @click="startRename(card.agent)">✎ 重命名</button><button role="menuitem" @click="openMenu = ''; openScope(card.agent)">☷ 编辑范围</button><button role="menuitem" class="danger" @click="openMenu = ''; removeAgent(card.agent)">⌫ 删除智能体</button></div></div></div>
        </article></div>
        <section class="agents-session-panel"><div class="agents-session-search"><LegacyIcon name="search" :size="14" /><input v-model="query" type="search" aria-label="搜索导入会话" placeholder="搜索对话…"></div><div class="agents-sessions"><p v-if="!visibleSessions.length" class="muted">当前范围暂无匹配会话。</p><article v-for="session in visibleSessions" :key="session.session_id || session.id" class="agents-session-row"><button class="agents-session-open" @click="openSession(session)"><template v-if="renamingSessionId === (session.session_id || session.id)"><input v-model="sessionRenameDraft" class="agents-session-rename-input" aria-label="对话标题" @click.stop @keyup.enter="commitSessionRename(session)" @keyup.esc="cancelSessionRename" @blur="commitSessionRename(session)"></template><template v-else><strong>{{ session.title || '未命名对话' }}</strong><p>{{ session.last_message }}</p><small>{{ new Date(session.updated_at * 1000).toLocaleString('zh-CN') }}</small></template></button><div><button title="重命名" aria-label="重命名对话" @click="startSessionRename(session)"><LegacyIcon name="edit" :size="14" /></button><button title="删除" aria-label="删除对话" @click="removeSession(session)"><LegacyIcon name="close" :size="14" /></button></div></article></div></section>
      </template>
    </section>
    </div>
  </main>
  <div v-if="showForm" class="agents-modal-overlay" @click.self="showForm = false"><section class="agents-connect-modal" role="dialog" aria-modal="true" aria-label="连接智能体"><header><div><h2>连接智能体</h2><p>接入后，即可在对话中直接调用。</p></div><button aria-label="关闭" @click="showForm = false"><LegacyIcon name="close" :size="16" /></button></header><form @submit.prevent="connect"><fieldset><legend>智能体</legend><div class="agents-backend-options"><button v-for="backend in available" :key="backend.kind" type="button" :class="{ active: kind === backend.kind }" @click="kind = backend.kind"><LegacyIcon name="agents" :size="15" />{{ backend.display_name }}</button></div></fieldset><label>名称<input v-model="name" required placeholder="例如：我的代码助手"></label><label v-if="kind !== 'hermes_remote'">工作目录（可选）<input v-model="cwd" placeholder="例如：/Users/you/project —— 智能体将在此目录运行"></label><p v-if="connectionError" class="error" role="alert">{{ connectionError }}</p><div class="agents-modal-actions"><button type="button" @click="showForm = false">取消</button><button class="primary" :disabled="busy || !name.trim()"><LegacyIcon name="plug" :size="14" />连接</button></div></form></section></div>
  <div v-if="wizardOpen" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="导入智能体会话" @click="wizardOpen = false"><section class="modal-panel" @click.stop><header class="modal-header"><h2>{{ editingAgent ? '编辑导入范围' : '导入智能体会话' }}</h2><button @click="wizardOpen = false">关闭</button></header><p>文件只在本机浏览器中读取，选择的项目或日期才会上传。</p><label>智能体名称<input v-model="agentName" placeholder="例如：我的 Claude" /></label><button :disabled="busy" @click="chooseFolder">选择 .claude 或 .codex 目录</button><template v-if="scan"><p>{{ scan.source }} · {{ groups.length }} 个可选范围</p><fieldset><legend>{{ unit === 'projects' ? '选择项目' : '选择日期' }}</legend><label v-for="group in groups" :key="group.key" class="settings-check"><input type="checkbox" :checked="selectedKeys.has(group.key)" @change="toggleGroup(group.key)">{{ group.label }}<small>{{ group.sublabel || `${group.sessions.length} 段对话` }}</small></label></fieldset><p v-if="progress.total">已处理 {{ progress.done }} / {{ progress.total }}</p><button class="primary" :disabled="busy || !selectedKeys.size || !agentName.trim()" @click="confirmImport">{{ busy ? '正在导入…' : editingAgent ? '保存范围并刷新' : '开始导入' }}</button></template></section></div>
</template>
