<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, post } from '../api'
import MarkdownView from '../components/MarkdownView.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import MemoryRunPanel from '../components/MemoryRunPanel.vue'
import MemoryArchivedBanner from '../components/MemoryArchivedBanner.vue'
import { scopedUrl } from '../workspaceScope'

interface Doc { layer: 'L2' | 'L3'; key: string; exists: boolean; updated_at: string | null; entry_count: number; backlog: number }
interface Entity { id: string; label: string; content?: string; ts?: string }
interface Snapshot { entities: Entity[]; pending_changes: ChangeEntry[]; last_refresh?: string }
interface ChangeEntry { ts?: string; kind?: string; entity_id?: string; label?: string }
interface Run { id?: string; run_id?: string; status?: string; error?: string }
interface RunEvent { seq: number; ts: string; payload: Record<string, unknown> }
interface RunStartOptions { mode: 'update' | 'audit' | 'dedup'; budget: number; iterations: number; selection: { profile_id: string; model_id: string } | null }
interface Line { number: number; kind: string; text: string }
const route = useRoute()
const docs = ref<Doc[]>([])
const backups = ref<string[]>([])
const latestBackup = computed(() => backups.value.at(-1) || null)
const snapshot = ref<Snapshot | null>(null)
const changes = ref<ChangeEntry[]>([])
const l1Mode = ref<'snapshot' | 'changes'>('snapshot')
const l1Snapshots = ref<Record<string, Snapshot>>({})
const content = ref('')
const lines = ref<Line[]>([])
const view = ref<'plain' | 'lines' | 'edit'>('plain')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const memoryMenuOpen = ref(false)
const activeRun = ref<Run | null>(null)
const runEvents = ref<RunEvent[]>([])
let runEventAbort: AbortController | undefined
const pendingFocus = ref('')
let poll: ReturnType<typeof setInterval> | undefined
let focusTimer: ReturnType<typeof setTimeout> | undefined
const surfaces = ['chat', 'notebook', 'quiz', 'kb', 'book', 'partner', 'cowriter']
const surfaceLabels: Record<string, string> = { chat: '聊天', notebook: '收藏夹', quiz: '测验', kb: '知识库', book: '书籍', partner: '伙伴', cowriter: 'Co-writer' }
const surfaceIcons: Record<string, string> = { chat: 'chat', notebook: 'bookmark', quiz: 'questions', kb: 'knowledge', book: 'learning', partner: 'agents', cowriter: 'note', recent: 'network', profile: 'network', scope: 'network' }
const layer = computed(() => route.path.startsWith('/memory/l2') ? 'L2' : route.path.startsWith('/memory/l3') ? 'L3' : 'L1')
const key = computed(() => String(route.params.surface || route.params.slot || route.query.surface || (layer.value === 'L1' ? 'notebook' : layer.value === 'L2' ? 'chat' : 'recent')))
const maintenanceLayer = computed<'L2' | 'L3'>(() => layer.value === 'L3' ? 'L3' : 'L2')
const l3Keys = ['recent', 'profile', 'scope']
const layerDocs = computed<Doc[]>(() => {
  const keys = layer.value === 'L2' ? surfaces : l3Keys
  return keys.map(docKey => docs.value.find(item => item.layer === layer.value && item.key === docKey) || {
    layer: layer.value as 'L2' | 'L3', key: docKey, exists: false, updated_at: null, entry_count: 0, backlog: 0,
  })
})
const currentDoc = computed(() => layerDocs.value.find(item => item.key === key.value))
const l3Labels: Record<string, string> = { recent: '近期总结', profile: '用户画像', scope: '知识 Scope', preferences: '偏好' }
function docLabel(doc: Doc) { return layer.value === 'L2' ? surfaceLabels[doc.key] || doc.key : l3Labels[doc.key] || doc.key }
const currentDocLabel = computed(() => layer.value === 'L2' ? surfaceLabels[key.value] || key.value : l3Labels[key.value] || key.value)
const l1Total = computed(() => Object.values(l1Snapshots.value).reduce((sum, item) => sum + (item.entities?.length || 0), 0))
const l2Total = computed(() => docs.value.filter(item => item.layer === 'L2').reduce((sum, item) => sum + item.entry_count, 0))
const l2SurfaceCount = computed(() => new Set(docs.value.filter(item => item.layer === 'L2').map(item => item.key)).size || surfaces.length)
const l3Total = computed(() => docs.value.filter(item => item.layer === 'L3' && item.key !== 'preferences').reduce((sum, item) => sum + item.entry_count, 0))
const l3SlotCount = computed(() => docs.value.filter(item => item.layer === 'L3' && item.key !== 'preferences').length || 3)
const renderedContent = computed(() => content.value.replace(/<!--\s*(m_[0-9A-HJKMNP-TV-Z]{26})\s*-->/g, '<span id="$1" class="memory-entry-anchor"></span>'))
const highlightedEntity = computed(() => String(route.query.ref || ''))
async function focusEntry() {
  if (!pendingFocus.value || view.value === 'edit') return
  await nextTick()
  if (focusTimer) clearTimeout(focusTimer)
  focusTimer = setTimeout(() => {
    const raw = pendingFocus.value
    const id = raw.startsWith('m_') ? raw : `m_${raw}`
    const anchor = document.getElementById(id)
    const item = anchor?.closest('li') as HTMLElement | null
    if (item) {
      item.scrollIntoView({ block: 'center', behavior: 'smooth' })
      item.classList.add('memory-entry-focused')
      setTimeout(() => item.classList.remove('memory-entry-focused'), 1800)
      pendingFocus.value = ''
    }
  }, 80)
}
async function focusEntity() {
  if (!highlightedEntity.value || layer.value !== 'L1') return
  await nextTick()
  document.getElementById(`memory-entity-${highlightedEntity.value}`)?.scrollIntoView({ block: 'center' })
}
async function loadL1Snapshots() { const results = await Promise.all(surfaces.map(async surface => { try { return [surface, await api<Snapshot>(`/api/memory/snapshot/${encodeURIComponent(surface)}`)] as const } catch { return [surface, { entities: [], pending_changes: [] }] as const } })); l1Snapshots.value = Object.fromEntries(results) }
async function load() {
  error.value = ''
  try {
    void loadL1Snapshots()
    const overview = await api<{ docs: Doc[]; backups?: string[] }>('/api/memory/overview')
    docs.value = overview.docs
    backups.value = overview.backups || []
    if (layer.value === 'L1' && key.value) {
      const [snapshotResult, changesResult] = await Promise.all([
        api<Snapshot>(`/api/memory/snapshot/${encodeURIComponent(key.value)}`),
        api<{ changes: ChangeEntry[] }>(`/api/memory/snapshot/${encodeURIComponent(key.value)}/changes`).catch(() => ({ changes: [] })),
      ])
      snapshot.value = snapshotResult
      changes.value = changesResult.changes || []
      await focusEntity()
    } else { snapshot.value = null; changes.value = [] }
    if (layer.value !== 'L1' && key.value) {
      const [document, lineResult] = await Promise.all([
        api<{ content: string }>(`/api/memory/doc/${layer.value}/${encodeURIComponent(key.value)}`),
        api<{ lines: Line[] }>(`/api/memory/doc/${layer.value}/${encodeURIComponent(key.value)}/lines`),
      ])
      content.value = document.content
      lines.value = lineResult.lines || []
      await focusEntry()
    } else { content.value = ''; lines.value = [] }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '记忆加载失败' }
}
watch(() => route.fullPath, () => { memoryMenuOpen.value = false; l1Mode.value = 'snapshot'; runEvents.value = []; runEventAbort?.abort(); pendingFocus.value = String(route.query.focus || ''); view.value = 'plain'; void load() }, { immediate: true })
onBeforeUnmount(() => { if (poll) clearInterval(poll); if (focusTimer) clearTimeout(focusTimer); runEventAbort?.abort() })
function changeLabel(change: ChangeEntry) { return change.label || change.entity_id || '未命名变更' }
async function refreshSnapshot() {
  busy.value = true
  error.value = ''
  try { await post(`/api/memory/snapshot/${encodeURIComponent(key.value)}/refresh`, {}); await load(); notice.value = '快照已刷新' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '刷新失败' }
  finally { busy.value = false }
}
async function saveDoc() {
  busy.value = true
  error.value = ''
  try {
    await api(`/api/memory/doc/${layer.value}/${encodeURIComponent(key.value)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.value }) })
    await load()
    view.value = 'plain'
    notice.value = '文档已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
function finishRun(id: string) {
  if (poll) clearInterval(poll)
  poll = undefined
  busy.value = false
  void load().then(() => { if (activeRun.value?.id === id || activeRun.value?.run_id === id) notice.value = `整理任务：${activeRun.value.status}` })
}
async function startRun(mode: 'update' | 'audit' | 'dedup', options?: RunStartOptions) {
  busy.value = true
  error.value = ''
  notice.value = ''
  runEvents.value = []
  try {
    const payload = options
      ? { layer: layer.value, key: key.value, mode, budget: mode === 'dedup' ? null : options.budget, iterations: mode === 'dedup' ? options.iterations : null, llm_selection: options.selection, language: 'zh' }
      : { layer: layer.value, key: key.value, mode, language: 'zh' }
    activeRun.value = await post<Run>('/api/memory/runs/start', payload)
    const id = activeRun.value.id || activeRun.value.run_id
    if (!id) throw new Error('任务未返回 ID')
    if (options) void streamRunEvents(id)
    const check = async () => {
      try {
        activeRun.value = await api<Run>(`/api/memory/runs/${encodeURIComponent(id)}`)
        if (activeRun.value.status && !['pending', 'running', 'queued'].includes(activeRun.value.status)) finishRun(id)
        if (activeRun.value.error) error.value = activeRun.value.error
      } catch { if (poll) clearInterval(poll); poll = undefined; busy.value = false; error.value = '无法获取整理任务状态' }
    }
    await check()
    if (busy.value) poll = setInterval(check, 1500)
  } catch (cause) { busy.value = false; error.value = cause instanceof Error ? cause.message : '启动失败' }
}
async function streamRunEvents(id: string) {
  runEventAbort?.abort()
  const controller = new AbortController()
  runEventAbort = controller
  try {
    const response = await fetch(scopedUrl(`/api/memory/runs/${encodeURIComponent(id)}/events?since=0`), { credentials: 'include', signal: controller.signal })
    if (!response.ok || !response.body) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const seen = new Set<number>()
    const consume = (block: string) => {
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (!data) return
      const event = JSON.parse(data) as RunEvent
      if (!seen.has(event.seq)) { seen.add(event.seq); runEvents.value = [...runEvents.value, event].sort((a, b) => a.seq - b.seq) }
    }
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) consume(block)
      if (done) { if (buffer.trim()) consume(buffer); break }
    }
  } catch { /* Status polling still completes if a trace stream is interrupted. */ }
}
async function resetMemory() {
  try {
    await post(`/api/memory/doc/${layer.value}/${encodeURIComponent(key.value)}/reset`, {})
    activeRun.value = null
    runEvents.value = []
    notice.value = '记忆已重置'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '重置失败' }
}
async function cancelRun() {
  const id = activeRun.value?.id || activeRun.value?.run_id
  if (!id) return
  try { await post(`/api/memory/runs/${encodeURIComponent(id)}/cancel`, {}); notice.value = '已请求取消' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '取消失败' }
}
</script>

<template>
  <main class="feature-page memory-page" :class="{ 'is-hub': route.path === '/memory' }"><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><template v-if="route.path === '/memory'"><nav class="memory-page-bar" aria-label="位置"><div class="memory-crumb-wrap"><button type="button" class="memory-crumb" aria-haspopup="menu" :aria-expanded="memoryMenuOpen" @click.stop="memoryMenuOpen = !memoryMenuOpen" @keydown.esc="memoryMenuOpen = false"><span aria-hidden="true"><LegacyIcon name="memory" :size="14" /></span>记忆</button><template v-if="memoryMenuOpen"><div class="memory-menu-dismiss" @click="memoryMenuOpen = false"></div><div class="memory-resource-menu" role="menu" aria-label="个性化"><p>个性化</p><RouterLink role="menuitem" to="/personalization" @click="memoryMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" to="/agents" @click="memoryMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" to="/space/personas" @click="memoryMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" to="/space/skills" @click="memoryMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" to="/space/mcp" @click="memoryMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" to="/space/cli-apps" @click="memoryMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" class="is-active" to="/memory" @click="memoryMenuOpen = false">记忆</RouterLink></div></template></div><div class="memory-bar-actions"><button type="button" @click="load"><LegacyIcon name="refreshCw" :size="13" />刷新</button><RouterLink to="/settings#memory">记忆设置</RouterLink></div></nav><div class="memory-hub-content"><header class="memory-hub-header"><span class="memory-page-icon" aria-hidden="true"><LegacyIcon name="memory" :size="16" /></span><div><h1>记忆</h1><p>DeepTutor 关于你的全部记忆，分为三层组织。点击任何一层进入查看或整理。</p></div><div><button @click="load"><LegacyIcon name="refreshCw" :size="13" />刷新</button><RouterLink to="/settings#memory">记忆设置</RouterLink></div></header><div class="memory-layer-grid"><RouterLink to="/memory/l1" class="memory-layer-card"><header><span><LegacyIcon name="layers" :size="16" /></span><small>实时</small></header><h2>L1 · 工作区镜像</h2><div><strong>{{ l1Total }}</strong><span>条 workspace 实体</span></div><p>对你 {{ surfaces.length }} 个 surface 工作区的快照。点击 Refresh 记录变化。</p><span class="memory-card-hover">实时 <i>→</i></span></RouterLink><RouterLink to="/memory/l2" class="memory-layer-card"><header><span><LegacyIcon name="workflow" :size="16" /></span><small>整理后</small></header><h2>L2 · 各模块摘要</h2><div><strong>{{ l2Total }}</strong><span>条事实，共 {{ l2SurfaceCount }} 个 surface</span></div><p>由 consolidator 抽取的、每个 surface 的事实。每个文档支持 更新 / 检查 / 去重。</p><span class="memory-card-hover">整理后 <i>→</i></span></RouterLink><RouterLink to="/memory/l3" class="memory-layer-card"><header><span><LegacyIcon name="network" :size="16" /></span><small>综合</small></header><h2>L3 · 跨模块知识</h2><div><strong>{{ l3Total }}</strong><span>条命题，共 {{ l3SlotCount }} 个 slot</span></div><p>跨 surface 综合：用户画像、近期时间线、知识 scope。每条判断都有 L2 证据。</p><span class="memory-card-hover">综合 <i>→</i></span></RouterLink></div><RouterLink to="/memory/graph" class="memory-graph-callout"><span><LegacyIcon name="sparkles" :size="20" /></span><div><h2>记忆图谱 <small>新建</small></h2><p>一次查看全部三层 —— 中心为 L3 综合，中圈为 L2 事实，外圈为 L1 原始事件。悬停任意节点可预览。</p></div><i>→</i></RouterLink><MemoryArchivedBanner :latest-backup="latestBackup" /></div></template><template v-else><nav class="memory-page-bar" aria-label="位置"><div class="memory-crumb-wrap"><button type="button" class="memory-crumb" aria-haspopup="menu" :aria-expanded="memoryMenuOpen" @click.stop="memoryMenuOpen = !memoryMenuOpen" @keydown.esc="memoryMenuOpen = false"><span aria-hidden="true"><LegacyIcon name="memory" :size="14" /></span>记忆</button><template v-if="memoryMenuOpen"><div class="memory-menu-dismiss" @click="memoryMenuOpen = false"></div><div class="memory-resource-menu" role="menu" aria-label="个性化"><p>个性化</p><RouterLink role="menuitem" to="/personalization" @click="memoryMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" to="/agents" @click="memoryMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" to="/space/personas" @click="memoryMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" to="/space/skills" @click="memoryMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" to="/space/mcp" @click="memoryMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" to="/space/cli-apps" @click="memoryMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" class="is-active" to="/memory" @click="memoryMenuOpen = false">记忆</RouterLink></div></template></div></nav><div class="memory-workbench-content"><header class="memory-workbench-header"><div class="memory-breadcrumb"><RouterLink to="/memory">← 记忆</RouterLink><span>/</span><strong>{{ layer === 'L1' ? 'L1 · 工作区镜像' : layer === 'L2' ? 'L2 · 各模块摘要' : 'L3 · 跨模块知识' }}</strong><span v-if="key">/</span><span>{{ layer === 'L1' ? surfaceLabels[key] || key : currentDocLabel }}</span></div><nav class="memory-layer-switch"><RouterLink to="/memory/l1" :class="{ active: layer === 'L1' }">L1</RouterLink><RouterLink to="/memory/l2" :class="{ active: layer === 'L2' }">L2</RouterLink><RouterLink to="/memory/l3" :class="{ active: layer === 'L3' }">L3</RouterLink></nav></header><div class="memory-workbench" :class="{ 'with-run-panel': layer !== 'L1' }"><aside class="memory-rail"><template v-if="layer === 'L1'"><RouterLink v-for="surface in surfaces" :key="surface" :to="`/memory/l1?surface=${surface}`" :class="{ active: key === surface }"><span><LegacyIcon :name="surfaceIcons[surface]" :size="14" /></span><div>{{ surfaceLabels[surface] }}<small v-if="l1Snapshots[surface]?.pending_changes?.length" class="is-pending">{{ l1Snapshots[surface].pending_changes.length }} 个待提交</small><small v-else>{{ l1Snapshots[surface]?.entities?.length || 0 }}</small></div></RouterLink></template><template v-else><RouterLink v-for="doc in layerDocs" :key="doc.key" :to="`/memory/${layer.toLowerCase()}/${encodeURIComponent(doc.key)}`" :class="{ active: key === doc.key }"><span><LegacyIcon :name="surfaceIcons[doc.key] || 'memory'" :size="14" /></span><div>{{ docLabel(doc) }}<small v-if="doc.exists">{{ doc.entry_count }}<template v-if="doc.backlog"> · 待处理 {{ doc.backlog }}</template></small></div></RouterLink><p v-if="!layerDocs.length" class="muted">暂无文档。</p></template></aside><section class="memory-document" :class="{ 'l1-document': layer === 'L1' }"><template v-if="layer === 'L1'"><header class="memory-document-toolbar memory-l1-toolbar"><div class="memory-l1-mode"><button :class="{ active: l1Mode === 'snapshot' }" @click="l1Mode = 'snapshot'">快照</button><button :class="{ active: l1Mode === 'changes' }" @click="l1Mode = 'changes'">变更</button></div><span v-if="snapshot?.pending_changes?.length" class="memory-l1-pending">{{ snapshot.pending_changes.length }} 个待提交</span><button class="memory-l1-refresh" :disabled="busy" title="重新扫描工作区并记录变更" @click="refreshSnapshot">↻ 刷新</button></header><template v-if="l1Mode === 'snapshot'"><p class="memory-entity-count">{{ snapshot?.entities?.length || 0 }} 条实体<template v-if="snapshot?.last_refresh"> · 上次刷新 {{ snapshot.last_refresh }}</template></p><div class="memory-entity-list"><article v-for="entity in snapshot?.entities || []" :id="`memory-entity-${key}:${entity.id}`" :key="entity.id" class="memory-entity-card" :class="{ 'memory-entry-focused': highlightedEntity === `${key}:${entity.id}` }"><strong>{{ entity.label }}</strong><small>{{ entity.ts }}</small><details><summary>查看内容</summary><pre>{{ entity.content }}</pre></details></article><p v-if="!snapshot?.entities?.length" class="memory-empty">Workspace 里暂时没有内容。</p></div></template><div v-else class="memory-change-list"><div v-if="snapshot?.pending_changes?.length" class="memory-change-pending"><p>自上次刷新后有 {{ snapshot.pending_changes.length }} 项待提交变更，点击刷新写入变更日志。</p><article v-for="(change, index) in snapshot.pending_changes" :key="`pending-${index}`"><strong>{{ changeLabel(change) }}</strong><small>{{ change.kind }} · {{ change.entity_id }}</small></article></div><p v-if="!changes.length && !snapshot?.pending_changes?.length" class="memory-empty">还没有变更记录，点击刷新建立基线。</p><article v-for="(change, index) in changes" :key="`${change.ts}-${change.entity_id}-${index}`" class="memory-change-row"><strong>{{ changeLabel(change) }}</strong><small>{{ change.kind }} · {{ change.entity_id }} · {{ change.ts }}</small></article></div></template><template v-else><header class="memory-document-toolbar"><div class="memory-view-switch"><button :class="{ active: view === 'plain' }" @click="view = 'plain'"><LegacyIcon name="fileText" :size="14" />渲染视图</button><button :class="{ active: view === 'lines' }" @click="view = 'lines'"><LegacyIcon name="hash" :size="14" />带行号</button></div><button class="memory-edit-original" aria-label="编辑" :class="{ active: view === 'edit' }" @click="view = 'edit'"><LegacyIcon name="edit" :size="14" />编辑原文</button></header><div class="memory-document-content"><div v-if="!content && view !== 'edit'" class="memory-empty memory-document-empty"><LegacyIcon name="workflow" :size="24" /><p>空。点击 更新 从原始 trace 中抽取事实。</p></div><MarkdownView v-else-if="view === 'plain'" :content="renderedContent" /><pre v-else-if="view === 'lines'" class="memory-lines"><div v-for="line in lines" :key="line.number" :class="{ muted: line.kind === 'blank' || line.kind === 'title' }"><span>{{ line.number }}:</span> {{ line.text || ' ' }}</div></pre><form v-else class="memory-editor" @submit.prevent="saveDoc"><textarea v-model="content" rows="22" aria-label="记忆文档 Markdown" /><div><button type="button" @click="view = 'plain'">取消</button><button class="primary" :disabled="busy">保存文档</button></div></form></div></template></section><MemoryRunPanel v-if="layer !== 'L1'" :layer="maintenanceLayer" :doc-key="key" :busy="busy" :active-run="activeRun" :events="runEvents" @run="startRun($event.mode, $event)" @cancel="cancelRun" @reset="resetMemory" @clear="runEvents = []" /></div></div></template>
</main>
</template>
