<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'
import FolderGlyph from '../components/FolderGlyph.vue'
import AddMaterialsDialog from '../components/AddMaterialsDialog.vue'
import LegacyIcon from '../components/LegacyIcon.vue'

interface Material { material_id: string; title: string; filename: string; source_kind: string; render_mode: string; status: string; progress: number; created_at?: number; updated_at?: number; error_detail?: string; collections?: { workspace_id: string; title: string }[] }
interface Workspace { workspace_id: string; title: string; description: string; color?: string; updated_at?: number; active_material_id: string | null; tabs: { material: Material; tab_order: number }[] }
interface Session { session_id: string; title: string; active_material_id?: string; updated_at: number }
const route = useRoute()
const router = useRouter()
const materialView = computed(() => route.path === '/learning/reading/materials')
const workspaceId = computed(() => String(route.params.folderId || route.params.workspaceId || ''))
const workspaces = ref<Workspace[]>([])
const materials = ref<Material[]>([])
const workspace = ref<Workspace | null>(null)
const sessions = ref<Session[]>([])
const search = ref('')
const title = ref('')
const description = ref('')
const selectedMaterials = ref<string[]>([])
const importUrls = ref('')
const createOpen = ref(false)
const importOpen = ref(false)
const color = ref('')
const sort = ref<'recent' | 'name'>('recent')
const menuFor = ref('')
const editingWorkspace = ref<Workspace | null>(null)
const addOpen = ref(false)
const folderMenuOpen = ref(false)
const deleteOpen = ref(false)
const materialFilter = ref<'all' | 'unassigned' | 'processing' | 'failed'>('all')
const assignFor = ref<Material | null>(null)
const assignWorkspace = ref('')
const deleteFor = ref<Material | null>(null)
const folderColors = [{ key: '', label: '默认' }, { key: 'blue', label: '蓝色' }, { key: 'teal', label: '青色' }, { key: 'green', label: '绿色' }, { key: 'amber', label: '琥珀色' }, { key: 'orange', label: '橙色' }, { key: 'rose', label: '玫红色' }, { key: 'violet', label: '紫色' }, { key: 'slate', label: '石板色' }]
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const filteredWorkspaces = computed(() => workspaces.value.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(search.value.toLowerCase())).sort((a, b) => sort.value === 'name' ? a.title.localeCompare(b.title, 'zh-CN') : (b.updated_at || 0) - (a.updated_at || 0)))
const filteredMaterials = computed(() => materials.value.filter(item => `${item.title} ${item.filename}`.toLowerCase().includes(search.value.toLowerCase()) && (materialFilter.value === 'all' || (materialFilter.value === 'unassigned' ? !(item.collections?.length) : materialFilter.value === 'processing' ? ['processing','queued'].includes(item.status) : item.status === 'failed'))))
function materialDate(material: Material) { const time = material.created_at ?? material.updated_at; return time ? new Date(time * 1000).toLocaleDateString('zh-CN') : '—' }
async function load() {
  loading.value = true; error.value = ''
  try {
    const [w, m] = await Promise.all([api<{ workspaces: Workspace[] }>('/api/reading/workspaces'), api<{ materials: Material[] }>('/api/reading/library/materials')])
    workspaces.value = w.workspaces; materials.value = m.materials
    if (workspaceId.value) {
      const result = await api<{ workspace: Workspace; sessions: Session[] }>(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}`)
      workspace.value = result.workspace; sessions.value = result.sessions
      title.value = workspace.value.title; description.value = workspace.value.description
    } else { workspace.value = null; sessions.value = []; title.value = ''; description.value = '' }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '阅读资料加载失败' }
  finally { loading.value = false }
}
watch(() => route.fullPath, load, { immediate: true })
async function create() {
  if (!title.value.trim()) return
  busy.value = true; error.value = ''
  try {
    const result = await post<{ workspace: Workspace }>('/api/reading/workspaces', { title: title.value.trim(), description: description.value, color: color.value, material_ids: selectedMaterials.value })
    createOpen.value = false
    await router.push(`/learning/reading/folders/${encodeURIComponent(result.workspace.workspace_id)}`)
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建集合失败' }
  finally { busy.value = false }
}
async function save() {
  if (!workspace.value) return
  busy.value = true; error.value = ''
  try { await api(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.value.trim(), description: description.value, color: color.value }) }); await load(); notice.value = '集合已保存' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
function openCreate() { editingWorkspace.value = null; title.value = ''; description.value = ''; color.value = ''; selectedMaterials.value = []; createOpen.value = true }
function openEdit(item: Workspace) { editingWorkspace.value = item; title.value = item.title; description.value = item.description; color.value = item.color || ''; createOpen.value = true; menuFor.value = '' }
async function submitFolder() { if (editingWorkspace.value) { busy.value = true; try { await api(`/api/reading/workspaces/${encodeURIComponent(editingWorkspace.value.workspace_id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.value.trim(), description: description.value, color: color.value }) }); createOpen.value = false; editingWorkspace.value = null; await load() } finally { busy.value = false } } else await create() }
async function deleteCollection(item: Workspace) { if (!confirm(`删除集合“${item.title}”及其中的阅读会话？`)) return; await api(`/api/reading/workspaces/${encodeURIComponent(item.workspace_id)}`, { method: 'DELETE' }); menuFor.value = ''; await load() }
async function removeWorkspace() {
  if (!workspace.value || !confirm(`删除集合“${workspace.value.title}”及其中的阅读会话？`)) return
  try { await api(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}`, { method: 'DELETE' }); await router.push('/learning/reading') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  busy.value = true; error.value = ''
  try {
    for (const file of input.files) {
      const form = new FormData(); form.append('file', file); if (workspaceId.value) form.append('workspace_id', workspaceId.value)
      const response = await fetch(scopedUrl('/api/reading/materials'), { method: 'POST', credentials: 'include', body: form })
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.detail || `HTTP ${response.status}`) }
    }
    await load(); notice.value = '资料已上传'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '上传失败' }
  finally { busy.value = false; input.value = '' }
}
async function addMaterial(materialId: string) {
  if (!workspace.value) return
  busy.value = true; error.value = ''
  try { await post(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}/materials`, { material_id: materialId, make_active: false }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '添加失败' }
  finally { busy.value = false }
}
async function removeMaterial(materialId: string) {
  if (!workspace.value) return
  try { await api(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}/materials/${encodeURIComponent(materialId)}`, { method: 'DELETE' }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '移除失败' }
}
async function openFile(materialId: string) { await activate(materialId); await router.push(`/learning/reading/${encodeURIComponent(workspaceId.value)}/sessions`) }
function openAddMaterials() { selectedMaterials.value = []; addOpen.value = true; folderMenuOpen.value = false }
async function materialsDone() { importOpen.value = false; addOpen.value = false; await load(); notice.value = '资料已添加' }
async function submitAddMaterials() { for (const id of selectedMaterials.value) await addMaterial(id); selectedMaterials.value = []; addOpen.value = false; if (importUrls.value.trim()) await importLinks(); await load() }
async function activate(materialId: string) {
  if (!workspace.value) return
  try { await api(`/api/reading/workspaces/${encodeURIComponent(workspaceId.value)}/materials/${encodeURIComponent(materialId)}/active`, { method: 'PUT' }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '切换失败' }
}
function openAssign(material: Material) { assignFor.value = material; assignWorkspace.value = workspaces.value[0]?.workspace_id || ''; menuFor.value = '' }
async function assignMaterial() { if (!assignFor.value || !assignWorkspace.value) return; await post(`/api/reading/workspaces/${encodeURIComponent(assignWorkspace.value)}/materials`, { material_id: assignFor.value.material_id, make_active: false }); assignFor.value = null; await load() }
async function removeLibraryMaterial(material: Material) {
  if (!confirm(`永久删除资料“${material.title || material.filename}”？`)) return
  try { await api(`/api/reading/materials/${encodeURIComponent(material.material_id)}`, { method: 'DELETE' }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
}
async function importLinks() {
  const urls = importUrls.value.split(/\n+/).map(item => item.trim()).filter(Boolean)
  if (!urls.length) return
  busy.value = true; error.value = ''
  try { await post('/api/reading/library/import-urls', { urls, ...(workspaceId.value ? { workspace_id: workspaceId.value } : {}) }); importUrls.value = ''; await load(); notice.value = '链接已提交导入' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '导入失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="feature-page reading-page"><header class="reading-page-bar"><div><h1><LegacyIcon name="bookText" :size="15" :stroke-width="1.6" />沉浸式阅读</h1><p>把 PDF、网页、讲座视频放进一个资料组，和 AI 一起精读，每句话都能回到原文。</p></div><button class="primary" @click="materialView ? importOpen = true : openCreate()"><span>＋</span>{{ materialView ? '导入资料' : '新建资料组' }}</button></header><nav class="reading-library-tabs"><RouterLink to="/learning/reading">资料组 <small>{{ workspaces.length }}</small></RouterLink><RouterLink to="/learning/reading/materials">资料库 <small>{{ materials.length }}</small></RouterLink></nav>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="loading" class="muted">加载中…</p>
    <template v-if="!workspaceId"><div class="reading-library-tools"><label class="reading-search"><span>⌕</span><input v-model="search" type="search" placeholder="搜索资料组和资料"><button v-if="search" aria-label="清除" @click="search = ''">×</button></label><div><span>{{ materialView ? `${filteredMaterials.length} 份资料` : `${filteredWorkspaces.length} 个资料组` }}</span><button v-if="!materialView" :class="{ active: sort === 'recent' }" @click="sort = 'recent'">近期</button><button v-if="!materialView" :class="{ active: sort === 'name' }" @click="sort = 'name'">名称</button></div></div>
      <template v-if="materialView"><div class="reading-material-filters"><button :class="{ active: materialFilter === 'all' }" @click="materialFilter = 'all'">全部</button><button :class="{ active: materialFilter === 'unassigned' }" @click="materialFilter = 'unassigned'">未加入资料组 <small>{{ materials.filter(item => !item.collections?.length).length }}</small></button><button :class="{ active: materialFilter === 'processing' }" @click="materialFilter = 'processing'">准备中 <small>{{ materials.filter(item => ['processing','queued'].includes(item.status)).length }}</small></button><button :class="{ active: materialFilter === 'failed' }" @click="materialFilter = 'failed'">失败 <small>{{ materials.filter(item => item.status === 'failed').length }}</small></button></div><div class="reading-material-head"><span></span><span>资料</span><span>类型</span><span>所属资料组</span><span>添加时间</span><span></span></div><p v-if="!filteredMaterials.length" class="reading-material-empty">{{ search ? '没有匹配的资料。' : '上传的资料会显示在这里。' }}</p><ul v-else class="reading-material-list"><li v-for="material in filteredMaterials" :key="material.material_id"><span class="reading-file-icon">{{ ['processing','queued'].includes(material.status) ? '↻' : material.source_kind === 'web' ? '◎' : material.source_kind === 'video' ? '▶' : '▤' }}</span><div class="reading-material-title"><strong>{{ material.title || material.filename }}</strong><small>{{ material.filename }}<template v-if="material.status === 'failed'"> · 准备失败</template></small></div><span class="reading-material-type">{{ material.source_kind === 'file' ? material.filename.split('.').pop()?.toUpperCase() : material.source_kind }}</span><div class="reading-material-collections"><RouterLink v-for="collection in material.collections" :key="collection.workspace_id" :to="`/learning/reading/folders/${collection.workspace_id}`">{{ collection.title }}</RouterLink><span v-if="!material.collections?.length">—</span></div><time>{{ materialDate(material) }}</time><div class="reading-material-actions"><button aria-label="资料操作" :aria-expanded="menuFor === material.material_id" @click="menuFor = menuFor === material.material_id ? '' : material.material_id">•••</button><div v-if="menuFor === material.material_id" class="reading-folder-menu"><button @click="openAssign(material)">＋ 分配到资料组</button><button class="legacy-danger" @click="deleteFor = material; menuFor = ''">⌫ 删除资料</button></div></div></li></ul></template>
      <template v-else><section v-if="!loading && !filteredWorkspaces.length" class="reading-empty"><h2>还没有资料组</h2><p>一个资料组就是一次阅读任务：一篇论文加它的综述、一门课的全部讲座、一本书的几个章节。放进去的资料共享同一批对话和批注。</p><button class="primary" @click="openCreate">新建资料组</button></section><ul v-else class="reading-folder-grid"><li v-for="item in filteredWorkspaces" :key="item.workspace_id" class="reading-folder-card"><RouterLink :to="`/learning/reading/folders/${encodeURIComponent(item.workspace_id)}`"><FolderGlyph :color="item.color" :files="item.tabs?.length || 0" :size="64" /><strong>{{ item.title }}</strong><small>{{ item.tabs?.length ? `${item.tabs.length} 份资料` : '空' }}<template v-if="item.updated_at"> · {{ new Date(item.updated_at * 1000).toLocaleDateString('zh-CN') }}</template></small></RouterLink><button class="reading-folder-menu-button" aria-label="资料组菜单" :aria-expanded="menuFor === item.workspace_id" @click="menuFor = menuFor === item.workspace_id ? '' : item.workspace_id">•••</button><div v-if="menuFor === item.workspace_id" class="reading-folder-menu"><RouterLink :to="`/learning/reading/${encodeURIComponent(item.workspace_id)}/sessions`">▱ 开始阅读</RouterLink><button @click="openEdit(item)">✎ 编辑资料组</button><button class="legacy-danger" @click="deleteCollection(item)">⌫ 删除资料组</button></div></li></ul></template>
    </template>


    <template v-else-if="workspace"><div class="reading-folder-detail"><nav class="reading-folder-breadcrumb"><RouterLink to="/learning/reading">沉浸式阅读</RouterLink><span>›</span><strong>{{ workspace.title }}</strong></nav><header class="reading-folder-header"><div><h1>{{ workspace.title }}</h1><p>{{ workspace.tabs.length }} 份资料</p></div><div class="reading-folder-actions"><RouterLink v-if="workspace.tabs.length" class="primary" :to="`/learning/reading/${encodeURIComponent(workspaceId)}/sessions`">▱ 开始阅读</RouterLink><button @click="openAddMaterials">＋ 添加资料</button><div class="reading-folder-menu-wrap"><button aria-label="资料组菜单" :aria-expanded="folderMenuOpen" @click="folderMenuOpen = !folderMenuOpen">•••</button><div v-if="folderMenuOpen" class="reading-folder-menu"><button @click="openEdit(workspace); folderMenuOpen = false">🎨 重命名或换色</button><button class="legacy-danger" @click="deleteOpen = true; folderMenuOpen = false">⌫ 删除资料组</button></div></div></div></header><section class="reading-folder-section"><h2>资料 <small>{{ workspace.tabs.length }}</small></h2><ul v-if="workspace.tabs.length" class="reading-file-list"><li v-for="tab in workspace.tabs" :key="tab.material.material_id"><button class="reading-file-open" @click="openFile(tab.material.material_id)"><span class="reading-file-icon">{{ ['processing','queued'].includes(tab.material.status) ? '↻' : tab.material.source_kind === 'web' ? '◎' : tab.material.source_kind === 'video' ? '▶' : '▤' }}</span><span><strong>{{ tab.material.title || tab.material.filename }}</strong><small :class="{ error: tab.material.status === 'failed' }">{{ ['processing','queued'].includes(tab.material.status) ? '正在准备' : tab.material.status === 'failed' ? '无法准备这份资料' : `${tab.material.source_kind} · ${tab.material.status}` }}</small></span><i v-if="workspace.active_material_id === tab.material.material_id">当前</i></button><button class="reading-file-remove" title="从资料组移除" @click="removeMaterial(tab.material.material_id)">×</button></li></ul><button v-else class="reading-folder-empty-files" @click="openAddMaterials"><span>＋</span><strong>这个资料组是空的</strong><small>添加论文、章节、网页或视频，一起阅读。</small></button></section><section class="reading-folder-section"><h2>对话 <small>{{ sessions.length }}</small></h2><ul v-if="sessions.length" class="reading-file-list"><li v-for="session in sessions" :key="session.session_id"><RouterLink class="reading-session-link" :to="`/learning/reading/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(session.session_id)}`"><span>☵</span><strong>{{ session.title || '新的阅读对话' }}</strong><small>{{ new Date(session.updated_at * 1000).toLocaleDateString('zh-CN') }}</small><i>→</i></RouterLink></li></ul><p v-else class="reading-session-empty">阅读这个资料组时产生的对话会显示在这里。</p></section></div></template>
    <AddMaterialsDialog v-if="addOpen" mode="add" :workspace-id="workspaceId" @close="addOpen = false" @done="materialsDone" />
    <Teleport to="body"><div v-if="deleteOpen" class="reading-dialog-overlay" @click.self="deleteOpen = false"><section class="reading-delete-dialog" role="alertdialog" aria-modal="true"><h2>删除资料组？</h2><p>“{{ workspace?.title }}”及其中的阅读会话将被删除，资料库中的文件会保留。</p><div class="reading-dialog-actions"><button @click="deleteOpen = false">取消</button><button class="primary" @click="removeWorkspace">永久删除</button></div></section></div></Teleport>
    <Teleport to="body"><div v-if="createOpen" class="reading-dialog-overlay" @click.self="createOpen = false"><form class="reading-folder-dialog" role="dialog" aria-modal="true" :aria-label="editingWorkspace ? '编辑资料组' : '新建资料组'" @submit.prevent="submitFolder"><h2>{{ editingWorkspace ? '编辑资料组' : '新建资料组' }}</h2><div class="reading-folder-name"><FolderGlyph :color="color" :files="editingWorkspace?.tabs.length || 0" :size="44" /><input v-model="title" aria-label="资料组名称" placeholder="未命名资料组" maxlength="300" autofocus></div><fieldset><legend>颜色</legend><div class="reading-color-options"><button v-for="option in folderColors" :key="option.key" type="button" :class="[`folder-tone-${option.key || 'default'}`, { selected: color === option.key }]" :aria-label="option.label" :aria-pressed="color === option.key" @click="color = option.key"></button></div></fieldset><div class="reading-dialog-actions"><button type="button" @click="createOpen = false">取消</button><button class="primary" :disabled="busy">{{ editingWorkspace ? '保存' : '创建' }}</button></div></form></div></Teleport>
    <AddMaterialsDialog v-if="importOpen" mode="upload" @close="importOpen = false" @done="materialsDone" />
    <Teleport to="body"><div v-if="assignFor" class="reading-dialog-overlay" @click.self="assignFor = null"><form class="reading-folder-dialog" role="dialog" aria-modal="true" aria-label="分配到资料组" @submit.prevent="assignMaterial"><h2>分配到资料组</h2><p class="reading-dialog-description">{{ assignFor?.title || assignFor?.filename }}</p><label class="reading-assign-label">资料组<select v-model="assignWorkspace"><option v-for="item in workspaces" :key="item.workspace_id" :value="item.workspace_id">{{ item.title }}</option></select></label><div class="reading-dialog-actions"><button type="button" @click="assignFor = null">取消</button><button class="primary" :disabled="!assignWorkspace">分配</button></div></form></div></Teleport>
    <Teleport to="body"><div v-if="deleteFor" class="reading-dialog-overlay" @click.self="deleteFor = null"><section class="reading-delete-dialog" role="alertdialog" aria-modal="true"><h2>永久删除资料？</h2><p>“{{ deleteFor?.title || deleteFor?.filename }}”将从资料库和所有资料组中删除。</p><div class="reading-dialog-actions"><button @click="deleteFor = null">取消</button><button class="primary" @click="removeLibraryMaterial(deleteFor!); deleteFor = null">永久删除</button></div></section></div></Teleport>
  </main>
</template>
