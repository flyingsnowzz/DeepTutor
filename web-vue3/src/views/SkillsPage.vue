<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, post } from '../api'
import MarkdownView from '../components/MarkdownView.vue'
import EduHubImport from '../components/EduHubImport.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import { isValidResourceName, slugifyResourceName } from '../resourceName'

interface Skill { name: string; description: string; content?: string; tags: string[]; source: 'user' | 'builtin' | 'admin'; read_only: boolean }
const route = useRoute()
const router = useRouter()
const scope = computed(() => String(route.query.skill_workspace || ''))
const endpoint = (path: string) => `${path}${scope.value ? `${path.includes('?') ? '&' : '?'}skill_workspace=${encodeURIComponent(scope.value)}` : ''}`
const skills = ref<Skill[]>([])
const tags = ref<string[]>([])
const filter = ref('all')
const search = ref('')
const selected = ref<Skill | null>(null)
const detailLoading = ref(false)
const editing = ref(false)
const originalName = ref('')
const name = ref('')
const description = ref('')
const content = ref('')
const editorTags = ref('')
const newTag = ref('')
const renamingTag = ref('')
const renameTagDraft = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const importOpen = ref(false)
const skillMenuOpen = ref(false)
const workspaces = ref<{ workspace_id: string; kind: string; display_name: string; archived: boolean }[]>([])
let detailVersion = 0
let loadVersion = 0
let mounted = true
const filtered = computed(() => skills.value.filter(item => (filter.value === 'all' || (filter.value === 'untagged' ? !item.tags.length : item.tags.includes(filter.value))) && `${item.name} ${item.description}`.toLowerCase().includes(search.value.toLowerCase())))
const filterCount = computed<Record<string, number>>(() => ({ all: skills.value.length, untagged: skills.value.filter(item => !item.tags.length).length, ...Object.fromEntries(tags.value.map(tag => [tag, skills.value.filter(item => item.tags.includes(tag)).length])) }))
const installedNames = computed(() => new Set(skills.value.map(item => item.name)))
async function load() {
  const version = ++loadVersion
  loading.value = true
  error.value = ''
  try {
    const [skillResult, tagResult] = await Promise.all([api<{ skills: Skill[] }>(endpoint('/api/skills/list')), api<{ tags: string[] }>(endpoint('/api/skills/tags/list'))])
    if (version !== loadVersion || !mounted) return
    skills.value = skillResult.skills || []
    tags.value = tagResult.tags || []
  } catch (cause) { if (version === loadVersion) error.value = cause instanceof Error ? cause.message : '技能库加载失败' }
  finally { if (version === loadVersion) loading.value = false }
}
watch(scope, load, { immediate: true })
onMounted(async () => { try { const result = await api<{ workspaces: typeof workspaces.value }>('/api/settings/workspace/registrations'); workspaces.value = result.workspaces.filter(item => item.kind === 'workspace' && !item.archived) } catch { /* Shared library remains available. */ } })
function changeScope(value: string) { const query = { ...route.query } as Record<string, string>; if (value) query.skill_workspace = value; else delete query.skill_workspace; void router.replace({ path: '/space/skills', query }) }
onUnmounted(() => { mounted = false; detailVersion++; loadVersion++ })
function create() {
  detailVersion++
  selected.value = null
  originalName.value = ''
  name.value = ''
  description.value = ''
  content.value = '# My Skill\n\nDescribe the task, procedure, constraints and expected output.\n'
  editorTags.value = ''
  editing.value = true
  error.value = ''
}
async function getDetail(item: Skill) {
  const version = ++detailVersion
  detailLoading.value = true
  error.value = ''
  try {
    const detail = await api<Skill>(endpoint(`/api/skills/${encodeURIComponent(item.name)}`))
    if (mounted && version === detailVersion) return detail
  } catch (cause) { if (version === detailVersion) error.value = cause instanceof Error ? cause.message : '技能读取失败' }
  finally { if (version === detailVersion) detailLoading.value = false }
  return null
}
async function show(item: Skill) {
  editing.value = false
  selected.value = { ...item, content: '' }
  const detail = await getDetail(item)
  if (detail && selected.value?.name === item.name) selected.value = detail
}
async function edit(item: Skill) {
  if (item.read_only) return
  editing.value = false
  selected.value = { ...item, content: '' }
  const detail = await getDetail(item)
  if (!detail) return
  originalName.value = detail.name
  name.value = detail.name
  description.value = detail.description
  content.value = detail.content || ''
  editorTags.value = (detail.tags || []).join(', ')
  editing.value = true
}
function updateName(value: string) { name.value = slugifyResourceName(value) }
function parsedTags() { return [...new Set(editorTags.value.split(/[,，\n]+/).map(item => item.trim().toLowerCase()).filter(Boolean))] }
async function save() {
  const target = name.value.trim()
  if (!isValidResourceName(target)) { error.value = '名称须由小写字母、数字和连字符组成，最长 64 字符。'; return }
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  const payload = { description: description.value, content: content.value, tags: parsedTags() }
  try {
    if (originalName.value) await api(endpoint(`/api/skills/${encodeURIComponent(originalName.value)}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, ...(target !== originalName.value ? { rename_to: target } : {}) }) })
    else await post(endpoint('/api/skills/create'), { name: target, ...payload })
    editing.value = false
    selected.value = null
    await load()
    notice.value = '技能已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
async function remove(item: Skill) {
  if (item.read_only || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ kind: 'skills', resource_id: item.name, skill_workspace: scope.value })
    const usage = await api<{ workspaces: { display_name: string }[] }>(`/api/settings/workspace/resource-usage?${params}`)
    const names = (usage.workspaces || []).map(workspace => workspace.display_name)
    const impact = names.length ? `\n\n正在使用的工作区：${names.join('、')}` : ''
    if (!confirm(`删除技能“${item.name}”？${impact}`)) return
    await api(endpoint(`/api/skills/${encodeURIComponent(item.name)}`), { method: 'DELETE' })
    if (selected.value?.name === item.name) selected.value = null
    await load()
    notice.value = '技能已删除'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busy.value = false }
}
async function addTag() {
  const tag = newTag.value.trim().toLowerCase()
  if (!tag || busy.value) return
  busy.value = true
  try { await post(endpoint('/api/skills/tags/create'), { name: tag }); newTag.value = ''; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '创建标签失败' }
  finally { busy.value = false }
}
function startRenameTag(tag: string) {
  renamingTag.value = tag
  renameTagDraft.value = tag
}
async function commitRenameTag() {
  const original = renamingTag.value
  const next = renameTagDraft.value.trim().toLowerCase()
  renamingTag.value = ''
  if (!original || !next || next === original) return
  try { await api(endpoint(`/api/skills/tags/${encodeURIComponent(original)}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rename_to: next }) }); if (filter.value === original) filter.value = next; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '重命名标签失败' }
}
function cancelRenameTag() { renamingTag.value = ''; renameTagDraft.value = '' }
async function deleteTag(tag: string) {
  if (!confirm(`删除标签“${tag}”？`)) return
  try { await api(endpoint(`/api/skills/tags/${encodeURIComponent(tag)}`), { method: 'DELETE' }); if (filter.value === tag) filter.value = 'all'; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除标签失败' }
}
async function installed() { await load(); notice.value = 'EduHub 技能已导入' }
</script>

<template>
  <main class="feature-page resource-page">
    <nav class="skill-page-bar" aria-label="位置"><div class="skill-crumb-wrap"><button type="button" class="skill-crumb" aria-haspopup="menu" :aria-expanded="skillMenuOpen" @click.stop="skillMenuOpen = !skillMenuOpen" @keydown.esc="skillMenuOpen = false"><span aria-hidden="true"><LegacyIcon name="skills" :size="14" /></span>技能</button><template v-if="skillMenuOpen"><div class="skill-menu-dismiss" @click="skillMenuOpen = false"></div><div class="skill-resource-menu" role="menu" aria-label="个性化"><p>个性化</p><RouterLink role="menuitem" to="/personalization" @click="skillMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" to="/agents" @click="skillMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" to="/space/personas" @click="skillMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" class="is-active" to="/space/skills" @click="skillMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" to="/space/mcp" @click="skillMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" to="/space/cli-apps" @click="skillMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" to="/memory" @click="skillMenuOpen = false">记忆</RouterLink></div></template></div><span>{{ filtered.length }} 个技能</span><div class="skill-bar-actions"><button type="button" @click="importOpen = true">从 EduHub 导入</button><button type="button" @click="create">＋ 新建技能</button></div></nav>
    <div class="skill-page-content"><RouterLink to="/personalization" class="text-button">← 个性化</RouterLink>
    <header class="feature-heading"><div><h1>技能库</h1><p>模型按需读取的能力手册。</p></div><div class="partner-actions"><button type="button" @click="importOpen = true">从 EduHub 导入</button><button type="button" class="primary" @click="create">新建技能</button></div></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="loading" class="muted" role="status">加载中…</p>
    <section class="skill-scope-panel"><p>账户资源库：在此管理资源，在设置中将资源分配给 工作区。 <RouterLink to="/settings#workspace">工作区</RouterLink></p><label>技能库 <select :value="scope" aria-label="技能库" @change="changeScope(($event.target as HTMLSelectElement).value)"><option value="">账户共享技能</option><option v-for="workspace in workspaces" :key="workspace.workspace_id" :value="workspace.workspace_id">{{ workspace.display_name }}</option><option v-if="scope && !workspaces.some(item => item.workspace_id === scope)" :value="scope">{{ scope }}</option></select></label><p>{{ scope ? '这里创建的技能属于当前工作区，同名技能启用时覆盖共享版本。' : '共享技能可分配给多个 工作区 使用。' }}</p></section><details class="reading-create resource-tags"><summary><span class="resource-tags-label"><LegacyIcon name="tag" :size="14" />管理标签 <b>{{ tags.length }}</b></span></summary><p class="muted">标签用于按用途分组；重命名会更新使用该标签的所有技能。</p><form class="resource-filters" @submit.prevent="addTag"><input v-model="newTag" aria-label="新标签" placeholder="新标签" maxlength="32"><button :disabled="!newTag.trim() || busy">添加</button></form><div v-for="tag in tags" :key="tag" class="reading-row resource-tag-row"><template v-if="renamingTag === tag"><input v-model="renameTagDraft" class="resource-tag-rename-input" aria-label="重命名标签" @keydown.enter.prevent="commitRenameTag" @keydown.esc="cancelRenameTag" @blur="commitRenameTag"><div class="partner-actions"><button type="button" aria-label="保存" @click="commitRenameTag">✓</button><button type="button" aria-label="取消" @click="cancelRenameTag">×</button></div></template><template v-else><span>{{ tag }}</span><div class="partner-actions"><button type="button" @click="startRenameTag(tag)">重命名</button><button type="button" @click="deleteTag(tag)">删除</button></div></template></div></details><div class="resource-tag-filters"><button :aria-pressed="filter === 'all'" @click="filter = 'all'">全部 {{ filterCount.all }}</button><button v-for="tag in tags" :key="tag" :aria-pressed="filter === tag" @click="filter = filter === tag ? 'all' : tag">{{ tag }} {{ filterCount[tag] || 0 }}</button><button :aria-pressed="filter === 'untagged'" @click="filter = 'untagged'">未分类 {{ filterCount.untagged }}</button></div><div class="resource-card-grid"><article v-for="item in filtered" :key="item.name" class="resource-item-card partner-card" role="button" tabindex="0" @click="show(item)" @keydown.enter="show(item)"><div class="resource-item-heading"><span class="resource-item-icon"><LegacyIcon name="skills" :size="13" /></span><div><div class="resource-title-line"><strong>{{ item.name }}</strong><span v-if="item.source === 'builtin'" class="resource-source-badge">内置</span></div><p>{{ item.description || '暂无描述' }}</p></div><div class="resource-item-actions partner-actions"><button v-if="!item.read_only" class="legacy-sr-only" @click.stop="edit(item)">编辑</button><button v-if="!item.read_only" class="legacy-sr-only" :disabled="busy" @click.stop="remove(item)">删除</button><button aria-label="查看" @click.stop="show(item)">查看</button><button v-if="!item.read_only" title="编辑" @click.stop="edit(item)">✎</button><button v-if="!item.read_only" title="删除" :disabled="busy" @click.stop="remove(item)">⌫</button></div></div><div class="channel-list"><button v-for="tag in item.tags" :key="tag" type="button" class="channel-tag" @click.stop="filter = tag">{{ tag }}</button><small v-if="!item.tags.length">{{ item.source === 'user' ? '未分类' : '内置' }}</small></div></article></div><p v-if="!loading && !filtered.length" class="resource-empty">暂无匹配技能。</p></div><div v-if="selected && !editing" class="resource-modal-overlay" @click.self="selected = null"><section class="resource-modal" role="dialog" aria-modal="true" :aria-label="selected.name"><header><div><h2>{{ selected.name }}</h2><p>{{ selected.description }}</p></div><div><button v-if="!selected.read_only" @click="edit(selected)">✎ 编辑</button><button aria-label="关闭" @click="selected = null">×</button></div></header><div class="resource-modal-body"><p v-if="detailLoading" role="status">加载中…</p><MarkdownView v-else :content="selected.content || ''" strip-frontmatter /></div></section></div><div v-if="editing" class="resource-modal-overlay" @click.self="editing = false"><section class="resource-modal resource-editor-modal resource-editor" role="dialog" aria-modal="true" :aria-label="originalName ? '编辑技能' : '新建技能'"><header><h2>{{ originalName ? '编辑技能' : '新建技能' }}</h2><button aria-label="取消" @click="editing = false">×</button></header><form class="settings-form" @submit.prevent="save"><label>名称<input :value="name" required maxlength="64" pattern="[a-z0-9][a-z0-9-]{0,63}" placeholder="research-helper" @input="updateName(($event.target as HTMLInputElement).value)"><small>仅限小写字母、数字和连字符。</small></label><label>描述<input v-model="description"></label><label>标签（逗号分隔）<input v-model="editorTags" placeholder="research, writing"></label><label>内容（Markdown）<textarea v-model="content" rows="14" required spellcheck="false" /></label><div class="resource-modal-actions"><button type="button" @click="editing = false">取消</button><button class="primary" :disabled="busy">{{ busy ? '保存中…' : '保存' }}</button></div></form></section></div><EduHubImport v-if="importOpen" :installed-names="installedNames" @close="importOpen = false" @installed="installed" />
  </main>
</template>
