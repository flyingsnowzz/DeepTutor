<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, post } from '../api'
import ChannelConfigForm from './ChannelConfigForm.vue'
import MarkdownView from './MarkdownView.vue'
import LegacyIcon from './LegacyIcon.vue'
import PartnerModelDropdown from './PartnerModelDropdown.vue'
import type { LLMOption, LLMOptionsResponse, LLMSelection } from '../partnerModel'

interface Tool { name: string; description?: string }
interface Asset { name: string; id?: string; record_count?: number; description?: string; available?: boolean; provenance_label?: string; metadata?: { type?: string } }
interface Workspace { workspace_id: string; kind: 'system' | 'general' | 'workspace'; display_name: string; archived: boolean; status: 'ready' | 'invalid' }
interface PartnerAssets { knowledge_bases: Asset[]; skills: Asset[]; notebooks: (Asset & { id: string })[] }
interface ProvisioningError { type: string; name: string; error: string }
type RemovableAssetType = 'knowledge_base' | 'skill' | 'notebook'
interface Link { key: string; channel: string; sender_id: string; linked_at: string }
const props = withDefaults(defineProps<{ partnerId: string; section: 'soul' | 'assets' | 'channels'; workspaceId?: string; llmSelection?: LLMSelection | null; backupLlmSelection?: LLMSelection | null; initialEnabledTools?: string[] | null; initialBuiltinTools?: string[] | null; initialMcpTools?: string[] | null }>(), { workspaceId: '', llmSelection: null, backupLlmSelection: null, initialEnabledTools: null, initialBuiltinTools: null, initialMcpTools: null })
const emit = defineEmits<{ notice: [message: string]; error: [message: string]; updated: [] }>()
const soul = ref('')
const llmOptions = ref<LLMOption[]>([])
const activeLLMDefault = ref<LLMSelection | null>(null)
const selection = ref<LLMSelection | null>(props.llmSelection)
const backupSelection = ref<LLMSelection | null>(props.backupLlmSelection)
const llmLoading = ref(true)
const llmError = ref(false)
const tools = ref<Tool[]>([])
const builtinTools = ref<Tool[]>([])
const mcpTools = ref<Tool[]>([])
const enabledTools = ref<string[]>([])
const enabledBuiltin = ref<string[]>([])
const enabledMcp = ref<string[]>([])
const toolOptionsLoaded = ref(false)
const assets = ref<PartnerAssets>({ knowledge_bases: [], skills: [], notebooks: [] })
const catalog = ref({ kbs: [] as Asset[], skills: [] as Asset[], notebooks: [] as (Asset & { id: string })[] })
const selectedKbs = ref<Set<string>>(new Set())
const selectedSkills = ref<Set<string>>(new Set())
const selectedNotebooks = ref<Set<string>>(new Set())
const partnerWorkspaceId = ref(props.workspaceId)
const workspaces = ref<Workspace[]>([])
const workspacesLoading = ref(false)
const workspacesError = ref('')
const savingWorkspace = ref(false)
const showAssetPicker = ref(false)
const catalogLoading = ref(true)
const addingAssets = ref(false)
const removingAsset = ref('')
const workspaceSelectId = `partner-workspace-${props.partnerId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
const pendingCount = computed(() => selectedKbs.value.size + selectedSkills.value.size + selectedNotebooks.value.size)
const visibleKbs = computed(() => catalog.value.kbs.filter(kb => kb.available !== false && !['subagent', 'obsidian', 'marginnote4'].includes(String(kb.metadata?.type || '')) && !assets.value.knowledge_bases.some(item => item.name === kb.name || item.name === kb.id)))
const visibleSkills = computed(() => catalog.value.skills.filter(skill => !assets.value.skills.some(item => item.name === skill.name)))
const visibleNotebooks = computed(() => catalog.value.notebooks.filter(notebook => !assets.value.notebooks.some(item => item.id === notebook.id || item.id === notebook.name)))
const assetRows = computed(() => [
  ...assets.value.knowledge_bases.map(item => ({ type: 'knowledge_base' as const, id: item.name, label: item.name, kind: '知识库' })),
  ...assets.value.skills.map(item => ({ type: 'skill' as const, id: item.name, label: item.name, kind: '技能' })),
  ...assets.value.notebooks.map(item => ({ type: 'notebook' as const, id: item.id, label: item.name || item.id, kind: '收藏夹' })),
])
watch(() => props.workspaceId, value => { partnerWorkspaceId.value = value || '' })
watch(() => props.llmSelection, value => { selection.value = value || null })
watch(() => props.backupLlmSelection, value => { backupSelection.value = value || null })
watch(() => props.initialEnabledTools, value => { if (value !== undefined) enabledTools.value = value || [] })
watch(() => props.initialBuiltinTools, value => { if (value !== undefined) enabledBuiltin.value = value || [] })
watch(() => props.initialMcpTools, value => { if (value !== undefined) enabledMcp.value = value || [] })
const schemaCatalog = ref<Record<string, any>>({})
const channels = ref<Record<string, any>>({})
const activeChannel = ref('')
const links = ref<Link[]>([])
const linkCode = ref('')
const runtime = ref<Record<string, any>>({})
const busy = ref(false); const soulMode = ref<'edit' | 'preview'>('edit')
function toggle(list: string[], value: string) { const index = list.indexOf(value); if (index >= 0) list.splice(index, 1); else list.push(value) }
function toggleSet(set: Set<string>, value: string) { if (set.has(value)) set.delete(value); else set.add(value) }
async function load() {
  const [soulResult, modelResult, toolResult, assetResult, kbResult, skillResult, notebookResult, schemaResult, linkResult, runtimeResult] = await Promise.allSettled([
    api<{ content: string }>(`/api/partners/${encodeURIComponent(props.partnerId)}/soul`),
    api<LLMOptionsResponse>('/api/settings/llm-options'), api<{ tools: Tool[]; builtin_tools: Tool[]; mcp_tools: Tool[] }>('/api/partners/tool-options'),
    api<typeof assets.value>(`/api/partners/${encodeURIComponent(props.partnerId)}/assets`), api<Asset[]>('/api/knowledge-bases/list'),
    api<{ skills: Asset[] }>('/api/skills/list'), api<{ notebooks: (Asset & { id: string })[] }>('/api/notebooks'),
    api<{ channels: Record<string, any> }>('/api/partners/channels/schema'), api<{ links: Link[] }>(`/api/partners/${encodeURIComponent(props.partnerId)}/links`),
    api<{ channels: Record<string, any> }>(`/api/partners/${encodeURIComponent(props.partnerId)}/channels/status`),
  ])
  if (soulResult.status === 'fulfilled') soul.value = soulResult.value.content
  if (modelResult.status === 'fulfilled') { llmOptions.value = modelResult.value.options || []; activeLLMDefault.value = modelResult.value.active || null; llmError.value = false }
  else llmError.value = true
  llmLoading.value = false
  if (toolResult.status === 'fulfilled') { tools.value = toolResult.value.tools; builtinTools.value = toolResult.value.builtin_tools; mcpTools.value = toolResult.value.mcp_tools; enabledTools.value = props.initialEnabledTools ?? toolResult.value.tools.map(item => item.name); enabledBuiltin.value = props.initialBuiltinTools ?? toolResult.value.builtin_tools.map(item => item.name); enabledMcp.value = props.initialMcpTools ?? []; toolOptionsLoaded.value = true }
  if (assetResult.status === 'fulfilled') assets.value = assetResult.value
  if (kbResult.status === 'fulfilled') catalog.value.kbs = kbResult.value
  if (skillResult.status === 'fulfilled') catalog.value.skills = skillResult.value.skills
  if (notebookResult.status === 'fulfilled') catalog.value.notebooks = notebookResult.value.notebooks
  catalogLoading.value = false
  if (schemaResult.status === 'fulfilled') { schemaCatalog.value = schemaResult.value.channels; activeChannel.value = Object.keys(schemaResult.value.channels)[0] || ''; const detail = await api<Record<string, any>>(`/api/partners/${encodeURIComponent(props.partnerId)}?include_secrets=true`); channels.value = detail.channels || {} }
  if (linkResult.status === 'fulfilled') links.value = linkResult.value.links
  if (runtimeResult.status === 'fulfilled') runtime.value = runtimeResult.value.channels
}
onMounted(() => { void load(); if (props.section === 'assets') void loadWorkspaces() })
async function saveSoulOnly() {
  busy.value = true
  try {
    await api(`/api/partners/${encodeURIComponent(props.partnerId)}/soul`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: soul.value }) })
    emit('notice', '灵魂已保存')
  } catch (cause) { emit('error', cause instanceof Error ? cause.message : '保存灵魂失败') }
  finally { busy.value = false }
}
async function saveModelSelection(next: LLMSelection | null, backup = false) {
  const previous = backup ? backupSelection.value : selection.value
  if (backup) backupSelection.value = next
  else selection.value = next
  try {
    await api(`/api/partners/${encodeURIComponent(props.partnerId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup ? { backup_llm_selection: next } : { llm_selection: next }) })
    emit('notice', '模型已更新——下一条消息起生效')
    emit('updated')
  } catch (cause) {
    if (backup) backupSelection.value = previous
    else selection.value = previous
    emit('error', cause instanceof Error ? cause.message : '保存模型失败')
  }
}
async function saveToolsOnly() {
  busy.value = true
  try {
    await api(`/api/partners/${encodeURIComponent(props.partnerId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled_tools: enabledTools.value, builtin_tools: enabledBuiltin.value, mcp_tools: enabledMcp.value }) })
    emit('notice', '工具已更新——下一条消息起生效')
    emit('updated')
  } catch (cause) { emit('error', cause instanceof Error ? cause.message : '保存工具失败') }
  finally { busy.value = false }
}
function workspaceLabel(row: Workspace) {
  if (row.kind === 'system') return '系统工作区'
  if (row.kind === 'general') return '通用工作区'
  return row.display_name
}
async function loadWorkspaces() {
  workspacesLoading.value = true
  workspacesError.value = ''
  try {
    const result = await api<{ workspaces: Workspace[] }>(`/api/partners/${encodeURIComponent(props.partnerId)}/workspaces`)
    workspaces.value = result.workspaces.filter(row => row.kind !== 'system' && !row.archived && row.status === 'ready')
  } catch (cause) {
    workspacesError.value = cause instanceof Error ? cause.message : '加载工作区失败'
  } finally {
    workspacesLoading.value = false
  }
}
async function saveWorkspace(workspaceId: string) {
  if (workspaceId === partnerWorkspaceId.value || savingWorkspace.value) return
  savingWorkspace.value = true
  try {
    const result = await api<{ workspace_id?: string }>(`/api/partners/${encodeURIComponent(props.partnerId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: workspaceId }) })
    partnerWorkspaceId.value = result.workspace_id || workspaceId
    showAssetPicker.value = false
    selectedKbs.value = new Set()
    selectedSkills.value = new Set()
    selectedNotebooks.value = new Set()
    emit('notice', '工作区已更新，将从下一条消息开始生效')
    emit('updated')
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : '保存工作区失败')
  } finally {
    savingWorkspace.value = false
  }
}
async function submitAssets() {
  if (!pendingCount.value || addingAssets.value) return
  addingAssets.value = true
  try {
    const result = await post<{ assets: PartnerAssets; copied: Record<string, string[]>; errors: ProvisioningError[] }>(`/api/partners/${encodeURIComponent(props.partnerId)}/assets`, { knowledge_bases: [...selectedKbs.value], skills: [...selectedSkills.value], notebooks: [...selectedNotebooks.value] })
    assets.value = result.assets
    if (result.errors?.length) emit('error', `部分内容失败：${result.errors.map(item => item.name).join('、')}`)
    else emit('notice', '已添加到资料库')
    selectedKbs.value = new Set()
    selectedSkills.value = new Set()
    selectedNotebooks.value = new Set()
    showAssetPicker.value = false
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : '添加知识资产失败')
  } finally {
    addingAssets.value = false
  }
}
async function removeAsset(assetType: RemovableAssetType, id: string) {
  const key = `${assetType}:${id}`
  if (removingAsset.value) return
  removingAsset.value = key
  try {
    const result = await api<{ assets: PartnerAssets }>(`/api/partners/${encodeURIComponent(props.partnerId)}/assets/${assetType}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    assets.value = result.assets
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : '移除知识资产失败')
  } finally {
    removingAsset.value = ''
  }
}
async function saveChannels() {
  busy.value = true
  try { await api(`/api/partners/${encodeURIComponent(props.partnerId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels: Object.fromEntries(Object.entries(channels.value).filter(([key]) => !['send_progress', 'send_tool_hints', 'sendProgress', 'sendToolHints'].includes(key))) }) }); emit('notice', '频道配置已保存'); await load() }
  catch (cause) { emit('error', cause instanceof Error ? cause.message : '保存频道失败') }
  finally { busy.value = false }
}
async function issueLink() { try { const result = await post<{ command: string }>(`/api/partners/${encodeURIComponent(props.partnerId)}/links/code`, {}); linkCode.value = result.command } catch (cause) { emit('error', cause instanceof Error ? cause.message : '创建链接码失败') } }
async function copyLink() { if (linkCode.value) await navigator.clipboard.writeText(linkCode.value); emit('notice', '链接命令已复制') }
async function removeLink(key: string) { await api(`/api/partners/${encodeURIComponent(props.partnerId)}/links/${encodeURIComponent(key)}`, { method: 'DELETE' }); links.value = links.value.filter(link => link.key !== key) }
</script>

<template>
  <section class="partner-config-panel">    <template v-if="section === 'soul'">
      <section class="partner-config-card partner-soul-card">
        <header><div><h3>灵魂</h3><p>伙伴的人格设定——注入每一次对话。</p></div><button class="partner-config-save" :disabled="busy" @click="saveSoulOnly"><LegacyIcon name="save" :size="14" :stroke-width="1.7" />保存</button></header>
        <div class="partner-soul-editor">
          <div class="partner-soul-toolbar"><span>SOUL.md</span><div><button type="button" :class="{ active: soulMode === 'edit' }" @click="soulMode = 'edit'"><LegacyIcon name="edit" :size="13" />编辑</button><button type="button" :class="{ active: soulMode === 'preview' }" @click="soulMode = 'preview'"><LegacyIcon name="eye" :size="13" />预览</button></div></div>
          <textarea v-show="soulMode === 'edit'" v-model="soul" aria-label="SOUL.md" rows="14"></textarea>
          <div v-show="soulMode === 'preview'" class="partner-soul-preview"><MarkdownView v-if="soul" :content="soul" /><p v-else class="muted">暂无内容</p></div>
        </div>
      </section>
      <section class="partner-config-card">
        <header><div><h3>模型</h3><p>主模型负责每一轮回答；当它彻底失败时，会用备用模型重试一次。</p></div></header>
        <div class="partner-model-form">
          <div><label>主模型</label><PartnerModelDropdown :options="llmOptions" :active-default="activeLLMDefault" :value="selection" :loading="llmLoading" :error="llmError" none-label="系统默认" @change="saveModelSelection($event)" /></div>
          <div><label>备用模型</label><PartnerModelDropdown :options="llmOptions" :active-default="activeLLMDefault" :value="backupSelection" :loading="llmLoading" :error="llmError" none-label="不设备用" none-detail="失败的轮次不会重试。" @change="saveModelSelection($event, true)" /></div>
        </div>
      </section>
      <section class="partner-config-card">
        <header><div><h3>工具</h3><p>该伙伴被允许使用的能力。</p></div><button class="partner-config-save" :disabled="busy || !toolOptionsLoaded" @click="saveToolsOnly"><LegacyIcon :name="busy ? 'loader' : 'save'" :size="14" :stroke-width="1.7" :class="{ 'is-spinning': busy }" />保存</button></header>
        <div class="partner-tool-sections"><section class="partner-tool-group"><header><h4>系统工具</h4><div><button type="button" @click="enabledTools = tools.map(item => item.name)">全部</button><button type="button" @click="enabledTools = []">无</button></div></header><div class="partner-tool-grid"><label v-for="tool in tools" :key="tool.name"><input type="checkbox" :checked="enabledTools.includes(tool.name)" @change="toggle(enabledTools, tool.name)"><span><strong>{{ tool.name }}</strong><small v-if="tool.description">{{ tool.description }}</small></span></label></div></section><section v-if="builtinTools.length" class="partner-tool-group"><header><h4>内置工具</h4><div><button type="button" @click="enabledBuiltin = builtinTools.map(item => item.name)">全部</button><button type="button" @click="enabledBuiltin = []">无</button></div></header><p class="partner-tool-note">当上下文需要时自动挂载——附加知识库、可用记忆、启用沙盒等。可以拒绝不希望该伙伴使用的工具。</p><div class="partner-tool-grid"><label v-for="tool in builtinTools" :key="tool.name"><input type="checkbox" :checked="enabledBuiltin.includes(tool.name)" @change="toggle(enabledBuiltin, tool.name)"><span><strong>{{ tool.name }}</strong><small v-if="tool.description">{{ tool.description }}</small></span></label></div></section><section class="partner-tool-group"><header><h4>记忆</h4></header><p class="partner-tool-note">始终启用并内置，不可配置。partner_read 可读取所有者共享记忆和伙伴自身记忆；partner_memorize 只写入伙伴自身记忆；partner_search 会按关键词搜索过去对话。</p></section><section v-if="mcpTools.length" class="partner-tool-group"><header><h4>MCP 工具</h4><div><button type="button" @click="enabledMcp = mcpTools.map(item => item.name)">全部</button><button type="button" @click="enabledMcp = []">无</button></div></header><div class="partner-tool-grid"><label v-for="tool in mcpTools" :key="tool.name"><input type="checkbox" :checked="enabledMcp.includes(tool.name)" @change="toggle(enabledMcp, tool.name)"><span><strong>{{ tool.name }}</strong><small v-if="tool.description">{{ tool.description }}</small></span></label></div></section></div>
      </section>
    </template>
<template v-else-if="section === 'assets'">
      <section class="partner-config-card partner-workspace-card">
        <header><div><h3>工作区</h3></div></header>
        <div class="partner-workspace-picker">
          <label :for="workspaceSelectId"><LegacyIcon name="folderOpen" :size="16" />工作区</label>
          <select :id="workspaceSelectId" :value="partnerWorkspaceId" :disabled="savingWorkspace || workspacesLoading" @change="saveWorkspace(($event.target as HTMLSelectElement).value)">
            <option value="">Partner 私有工作区</option>
            <option v-if="partnerWorkspaceId && !workspaces.some(row => row.workspace_id === partnerWorkspaceId)" :value="partnerWorkspaceId" disabled>{{ workspacesLoading ? '加载中…' : '已绑定的工作区不可用' }}</option>
            <option v-for="row in workspaces" :key="row.workspace_id" :value="row.workspace_id">{{ workspaceLabel(row) }}</option>
          </select>
          <p>{{ partnerWorkspaceId ? '此 Partner 共享工作区中的文件、知识库、技能和收藏夹，持续同步更新；生成的文件保存到该工作区的 outputs 目录。' : '使用私有工作区，或绑定已有工作区，持续共享其中的最新资源。' }}</p>
          <p v-if="workspacesError" class="partner-workspace-error" role="alert">{{ workspacesError }} <button type="button" @click="loadWorkspaces">重试</button></p>
        </div>
      </section>
      <section v-if="!partnerWorkspaceId" class="partner-config-card partner-library-card">
        <header><div><h3>资料库</h3><p>已复制进该伙伴工作区的知识库、技能与收藏夹。</p></div><button type="button" class="partner-library-toggle" @click="showAssetPicker = !showAssetPicker"><LegacyIcon :name="showAssetPicker ? 'close' : 'plus'" :size="14" />{{ showAssetPicker ? '取消' : '添加' }}</button></header>
        <div v-if="showAssetPicker" class="partner-asset-picker">
          <p v-if="catalogLoading" class="partner-asset-loading">正在加载你的资料库…</p>
          <template v-else>
            <div class="partner-asset-groups">
              <section class="partner-asset-group">
                <h4><LegacyIcon name="database" :size="16" />知识库<span v-if="selectedKbs.size">{{ selectedKbs.size }}</span></h4>
                <p v-if="!visibleKbs.length" class="partner-asset-group-empty">暂无可用知识库。</p>
                <div v-else class="partner-asset-chips"><button v-for="kb in visibleKbs" :key="kb.id || kb.name" type="button" :class="{ active: selectedKbs.has(kb.id || kb.name) }" :title="kb.provenance_label || kb.name" @click="toggleSet(selectedKbs, kb.id || kb.name)">{{ kb.name }}</button></div>
              </section>
              <section class="partner-asset-group">
                <h4><LegacyIcon name="bookOpen" :size="16" />技能<span v-if="selectedSkills.size">{{ selectedSkills.size }}</span></h4>
                <p v-if="!visibleSkills.length" class="partner-asset-group-empty">暂无可用技能。</p>
                <div v-else class="partner-asset-chips"><button v-for="skill in visibleSkills" :key="skill.name" type="button" :class="{ active: selectedSkills.has(skill.name) }" :title="skill.description || skill.name" @click="toggleSet(selectedSkills, skill.name)">{{ skill.name }}</button></div>
              </section>
              <section class="partner-asset-group">
                <h4><LegacyIcon name="notebookPen" :size="16" />收藏夹<span v-if="selectedNotebooks.size">{{ selectedNotebooks.size }}</span></h4>
                <p v-if="!visibleNotebooks.length" class="partner-asset-group-empty">暂无可用收藏夹。</p>
                <div v-else class="partner-asset-chips"><button v-for="notebook in visibleNotebooks" :key="notebook.id" type="button" :class="{ active: selectedNotebooks.has(notebook.id) }" :title="notebook.description || notebook.name" @click="toggleSet(selectedNotebooks, notebook.id)">{{ notebook.name }}</button></div>
              </section>
            </div>
            <p class="partner-asset-copy-note">选中的内容会复制进伙伴的私有工作区。</p>
          </template>
          <button type="button" class="partner-asset-submit" :disabled="addingAssets || pendingCount === 0" @click="submitAssets"><LegacyIcon :name="addingAssets ? 'loader' : 'plus'" :size="14" :class="{ 'is-spinning': addingAssets }" />复制进工作区{{ pendingCount > 0 ? ` (${pendingCount})` : '' }}</button>
        </div>
        <p v-if="!assetRows.length" class="partner-library-empty">还没有分配任何内容——这个伙伴只知道你告诉它的事。</p>
        <ul v-else class="partner-asset-list">
          <li v-for="row in assetRows" :key="`${row.type}:${row.id}`"><span>{{ row.label }}<small>{{ row.kind }}</small></span><button type="button" aria-label="移除" :title="`移除 ${row.label}`" :disabled="Boolean(removingAsset)" @click="removeAsset(row.type, row.id)"><LegacyIcon name="trash" :size="14" /></button></li>
        </ul>
      </section>
    </template>
    <template v-else><div class="partner-channels-panel"><div class="partner-channels-save-row"><button class="partner-config-save" :disabled="busy" @click="saveChannels"><LegacyIcon name="save" :size="14" :stroke-width="1.7" />保存</button></div><div class="partner-channel-layout"><aside><button v-for="(entry, name) in schemaCatalog" :key="name" :class="{ active: activeChannel === name, unavailable: entry.available === false }" @click="activeChannel = name"><span class="partner-channel-badge" :class="`is-${name}`"><LegacyIcon :name="name === 'telegram' ? 'send' : 'radio'" :size="12" :stroke-width="1.8" /></span><span>{{ entry.display_name || name }}</span><em v-if="channels[name]?.enabled"><i />已启用</em></button></aside><section v-if="activeChannel" class="partner-channel-card"><header><div><h3><span class="partner-channel-badge" :class="`is-${activeChannel}`"><LegacyIcon :name="activeChannel === 'telegram' ? 'send' : 'radio'" :size="14" :stroke-width="1.8" /></span>{{ schemaCatalog[activeChannel]?.display_name || activeChannel }}</h3></div><code>{{ activeChannel }}</code></header><div v-if="schemaCatalog[activeChannel]?.available === false || !schemaCatalog[activeChannel]?.json_schema" class="partner-channel-unavailable">此频道在服务器上不可用。{{ schemaCatalog[activeChannel]?.unavailable_reason }}</div><template v-else><ChannelConfigForm :schema="schemaCatalog[activeChannel].json_schema" :model-value="channels[activeChannel] || schemaCatalog[activeChannel].default_config || {}" :secret-fields="schemaCatalog[activeChannel].secret_fields" @update:model-value="channels[activeChannel] = $event" /></template></section></div></div></template>

  </section>
</template>
