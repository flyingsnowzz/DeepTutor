<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'
import LegacyIcon from './LegacyIcon.vue'

interface KBFile { name: string; type: 'file' | 'folder'; size?: number; mime_type?: string; modified?: number }
interface Row { path: string; name: string; type: 'file' | 'folder'; depth: number; file?: KBFile }
interface Node { path: string; name: string; type: 'file' | 'folder'; file?: KBFile; children: Node[] }
const props = defineProps<{ kbName: string; files: KBFile[]; readOnly?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const selected = ref<KBFile | null>(null)
const preview = ref('')
const previewLoading = ref(false)
const collapsed = ref(localStorage.getItem('deeptutor.knowledge.files.collapsed') === 'true')
const mobileOpen = ref(false)
const fullscreen = ref(false)
const query = ref('')
const expanded = ref<Set<string>>(new Set())
const newFolderOpen = ref(false)
const newFolderName = ref('')
const confirmDelete = ref('')
const moveOpen = ref('')
const moveTargets = ref<Record<string, string>>({})
const busy = ref(false)
const error = ref('')
const folders = computed(() => [...new Set(props.files.filter(file => file.type === 'folder').map(file => file.name).concat(props.files.filter(file => file.name.includes('/')).map(file => file.name.split('/').slice(0, -1).join('/'))))].filter(Boolean).sort())
const tree = computed(() => {
  const root: Node[] = []
  const nodes = new Map<string, Node>()
  const ensure = (path: string) => {
    if (nodes.has(path)) return nodes.get(path)!
    const node: Node = { path, name: path.split('/').pop() || path, type: 'folder', children: [] }
    nodes.set(path, node)
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (parent) ensure(parent).children.push(node)
    else root.push(node)
    return node
  }
  for (const path of folders.value) ensure(path)
  for (const file of props.files.filter(item => item.type === 'file')) {
    if (query.value && !file.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())) continue
    const parent = file.name.includes('/') ? file.name.slice(0, file.name.lastIndexOf('/')) : ''
    const node: Node = { path: file.name, name: file.name.split('/').pop() || file.name, type: 'file', file, children: [] }
    if (parent) ensure(parent).children.push(node)
    else root.push(node)
  }
  const sort = (items: Node[]) => { items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1); for (const item of items) sort(item.children) }
  sort(root)
  return root
})
const rows = computed(() => {
  const result: Row[] = []
  const visit = (nodes: Node[], depth: number) => {
    for (const node of nodes) {
      result.push({ path: node.path, name: node.name, type: node.type, depth, file: node.file })
      if (node.type === 'folder' && (query.value || expanded.value.has(node.path))) visit(node.children, depth + 1)
    }
  }
  visit(tree.value, 0)
  return result
})
const fileUrl = computed(() => selected.value ? scopedUrl(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/files/${selected.value.name.split('/').map(encodeURIComponent).join('/')}`) : '')
const previewKind = computed(() => {
  const name = selected.value?.name.toLocaleLowerCase() || ''
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'image'
  if (/\.pdf$/.test(name)) return 'pdf'
  return 'text'
})
function formatSize(bytes?: number) { if (!bytes) return ''; if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${bytes} B` }
function toggleCollapsed() { collapsed.value = !collapsed.value; localStorage.setItem('deeptutor.knowledge.files.collapsed', String(collapsed.value)) }
function openMobileTree() { mobileOpen.value = true }
function closeMobileTree() { mobileOpen.value = false }
function toggleFolder(path: string) { if (expanded.value.has(path)) expanded.value.delete(path); else expanded.value.add(path) }
async function selectFile(file: KBFile) {
  selected.value = file; preview.value = ''; closeMobileTree(); error.value = ''; previewLoading.value = true
  try { const result = await api<{ text?: string; content?: string }>(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/file-preview-text/${file.name.split('/').map(encodeURIComponent).join('/')}`); preview.value = result.text || result.content || '暂无可预览文本' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '预览失败' }
  finally { previewLoading.value = false }
}
async function createFolder() {
  if (!newFolderName.value.trim()) return
  busy.value = true; error.value = ''
  try { await post(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/folders`, { path: newFolderName.value.trim() }); newFolderName.value = ''; newFolderOpen.value = false; emit('refresh') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '新建文件夹失败' }
  finally { busy.value = false }
}
async function moveFile(file: KBFile) {
  const target = moveTargets.value[file.name]
  if (target === undefined) return
  busy.value = true; moveOpen.value = ''
  try { await post(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/files/move`, { source: file.name, dest_folder: target }); emit('refresh') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '移动失败' }
  finally { busy.value = false }
}
async function removeFile(file: KBFile) {
  busy.value = true; confirmDelete.value = ''
  try { await api(`/api/knowledge-bases/${encodeURIComponent(props.kbName)}/files/${file.name.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }); if (selected.value?.name === file.name) selected.value = null; emit('refresh') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busy.value = false }
}
watch(() => props.kbName, () => { selected.value = null; preview.value = ''; query.value = ''; expanded.value = new Set(folders.value) })
watch(folders, value => { expanded.value = new Set([...expanded.value, ...value]) }, { immediate: true })
watch(fullscreen, value => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') fullscreen.value = false }; if (value) window.addEventListener('keydown', handler); else window.removeEventListener('keydown', handler) })
</script>

<template>
  <div class="kb-files-workspace">
    <aside v-if="collapsed" class="kb-files-collapsed"><button aria-label="展开文件列表" @click="toggleCollapsed">☰</button><div /><button v-for="file in files.filter(item => item.type === 'file')" :key="file.name" :class="{ active: selected?.name === file.name }" :aria-label="file.name" @click="selectFile(file)">▤</button></aside>
    <button v-if="!collapsed && mobileOpen" type="button" class="kb-file-tree-backdrop" aria-label="关闭文件列表" @click="closeMobileTree" /><aside v-if="!collapsed" class="kb-file-tree" :class="{ 'mobile-open': mobileOpen }"><header><label><LegacyIcon name="search" :size="13" /><input v-model="query" type="search" aria-label="搜索文件" placeholder="搜索文件"></label><div><button v-if="!readOnly" title="新建文件夹" aria-label="新建文件夹" @click="newFolderOpen = !newFolderOpen">＋</button><button title="刷新" aria-label="刷新文件" @click="emit('refresh')">↻</button><button title="折叠" aria-label="折叠文件列表" @click="toggleCollapsed">⇤</button><button class="kb-file-tree-mobile-close" title="关闭" aria-label="关闭文件列表" @click="closeMobileTree">×</button></div></header><form v-if="newFolderOpen" @submit.prevent="createFolder"><input v-model="newFolderName" aria-label="文件夹名称" placeholder="文件夹名称" autofocus><button class="primary" :disabled="busy || !newFolderName.trim()">添加</button></form><p v-if="error" class="error" role="alert">{{ error }}</p><div class="kb-file-tree-rows"><p v-if="!rows.length" class="kb-empty">还没有文件。请使用“添加文档”页签上传。</p><div v-for="row in rows" :key="row.path" class="kb-tree-row" :style="{ paddingLeft: `${row.depth * 12 + 8}px` }"><button v-if="row.type === 'folder'" class="kb-tree-folder" @click="toggleFolder(row.path)"><span>{{ query || expanded.has(row.path) ? '⌄' : '›' }}</span>📁 {{ row.name }}</button><template v-else><button class="kb-tree-file" :class="{ active: selected?.name === row.path }" :aria-label="row.path" @click="selectFile(row.file!)">▤ <span><strong>{{ row.name }}</strong><small>{{ formatSize(row.file?.size) }}</small></span></button><div v-if="!readOnly" class="kb-tree-actions"><button title="移动到" :aria-label="`移动 ${row.path}`" @click="moveOpen = moveOpen === row.path ? '' : row.path">↗</button><button title="删除" :aria-label="`删除 ${row.path}`" @click="confirmDelete = row.path">×</button></div><div v-if="moveOpen === row.path" class="kb-tree-move"><select v-model="moveTargets[row.path]" :aria-label="`移动到 ${row.path}`" @change="moveFile(row.file!)"><option :value="undefined" disabled>选择目标</option><option value="">根目录</option><option v-for="folder in folders.filter(item => item !== row.path)" :key="folder" :value="folder">{{ folder }}</option></select></div><div v-if="confirmDelete === row.path" class="kb-tree-delete"><span>删除？</span><button :aria-label="`确认删除 ${row.path}`" @click="removeFile(row.file!)">✓</button><button aria-label="取消删除" @click="confirmDelete = ''">×</button></div></template></div></div></aside>
    <section class="kb-file-preview-pane" :class="{ fullscreen }"><header v-if="selected"><button class="kb-mobile-tree-open" aria-label="打开文件列表" @click="openMobileTree">☰</button><button class="kb-desktop-tree-toggle" :aria-label="collapsed ? '展开文件列表' : '折叠文件列表'" @click="toggleCollapsed">☰</button><span>▤</span><div><strong>{{ selected.name }}</strong><small>{{ selected.mime_type || '文档' }}<template v-if="selected.size"> · {{ formatSize(selected.size) }}</template></small></div><a :href="fileUrl" target="_blank" rel="noopener" aria-label="下载文件">⇩</a><button :aria-label="fullscreen ? '退出全屏' : '全屏预览'" @click="fullscreen = !fullscreen">{{ fullscreen ? '×' : '⛶' }}</button><button aria-label="关闭预览" @click="selected = null">×</button></header><header v-else class="empty"><button class="kb-mobile-tree-open" aria-label="打开文件列表" @click="openMobileTree">☰</button><button class="kb-desktop-tree-toggle" :aria-label="collapsed ? '展开文件列表' : '折叠文件列表'" @click="toggleCollapsed">☰</button></header><div v-if="!selected" class="kb-preview-empty"><span>▤</span><h2>选择文件进行预览</h2><p>从左侧列表选择文档，无需离开知识库即可查看。</p></div><div v-else-if="previewLoading" class="kb-preview-empty">加载中…</div><div v-else class="kb-preview-content"><img v-if="previewKind === 'image'" :src="fileUrl" :alt="selected.name"><iframe v-else-if="previewKind === 'pdf'" :src="fileUrl" :title="selected.name" /><pre v-else>{{ preview }}</pre></div></section>
  </div>
</template>
