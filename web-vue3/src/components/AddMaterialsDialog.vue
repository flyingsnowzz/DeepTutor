<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'
import LegacyIcon from './LegacyIcon.vue'
import WatchingBrowser from './WatchingBrowser.vue'

interface Material { material_id: string; title: string; filename: string; source_kind: string; size_bytes?: number }
interface DuplicateMatch { query: { filename?: string; url?: string }; kind: 'same_content' | 'same_name'; material: Material }
interface PendingItem { key: string; kind: 'file' | 'url' | 'library'; label: string; file?: File; url?: string; material?: Material; sizeBytes?: number; contentId?: string; match?: DuplicateMatch; decision: 'reuse' | 'separate' }
const ACCEPT = '.pdf,.epub,.ppt,.pptx,.doc,.docx,.txt,.md,.html,.htm,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.mov,.m4v,.webm,.mkv'
const props = defineProps<{ mode: 'upload' | 'add'; workspaceId?: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const items = ref<PendingItem[]>([])
const linkDraft = ref('')
const dragging = ref(false)
const checking = ref(false)
const working = ref(false)
const error = ref('')
const showPicker = ref(false)
const browserOpen = ref(false)
const pickerQuery = ref('')
const library = ref<Material[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const dialog = ref<HTMLElement | null>(null)
let checkVersion = 0
let previousOverflow = ''
const heading = computed(() => props.mode === 'add' ? '添加资料' : '上传资料')
const visibleLibrary = computed(() => library.value.filter(material => `${material.title} ${material.filename}`.toLowerCase().includes(pickerQuery.value.toLowerCase())))
function formatBytes(bytes?: number) { if (!bytes) return ''; return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
function addFiles(files: File[]) {
  const currentLength = items.value.length
  items.value.push(...files.map((file, index) => ({ key: `file:${file.name}:${file.size}:${currentLength + index}`, kind: 'file' as const, label: file.name, file, sizeBytes: file.size, decision: 'reuse' as const })))
  void checkDuplicates()
}
function addLink() {
  const urls = linkDraft.value.split(/[\s\n]+/).map(value => value.trim()).filter(value => /^https?:\/\//i.test(value))
  if (!urls.length) return
  const currentLength = items.value.length
  items.value.push(...urls.map((url, index) => ({ key: `url:${url}:${currentLength + index}`, kind: 'url' as const, label: url.replace(/^https?:\/\//, ''), url, decision: 'reuse' as const })))
  linkDraft.value = ''
  void checkDuplicates()
}
function onDrop(event: DragEvent) {
  event.preventDefault()
  dragging.value = false
  const files = [...(event.dataTransfer?.files || [])]
  if (files.length) addFiles(files)
  else {
    const text = event.dataTransfer?.getData('text/plain').trim() || ''
    if (/^https?:\/\//i.test(text)) { linkDraft.value = text; addLink() }
  }
}
async function contentId(file: File) {
  if (file.size > 96 * 1024 * 1024 || !globalThis.crypto?.subtle) return ''
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
  } catch { return '' }
}
async function checkDuplicates() {
  const version = ++checkVersion
  const pending = items.value.filter(item => item.kind !== 'library' && item.match === undefined)
  if (!pending.length) return
  checking.value = true
  try {
    const files = await Promise.all(pending.filter(item => item.file).map(async item => ({ key: item.key, filename: item.file!.name, size_bytes: item.file!.size, mime: item.file!.type, content_id: await contentId(item.file!) })))
    const urls = pending.filter(item => item.url).map(item => item.url!)
    const result = await api<{ matches: DuplicateMatch[] }>('/api/reading/library/duplicate-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: files.map(({ key: _key, ...rest }) => rest), urls }) })
    if (version !== checkVersion) return
    items.value = items.value.map(item => {
      if (item.kind === 'library' || item.match !== undefined) return item
      const hashed = files.find(row => row.key === item.key)
      const match = result.matches.find(row => item.url ? row.query.url === item.url : row.query.filename === item.file?.name)
      return { ...item, contentId: hashed?.content_id, match: match || ({} as DuplicateMatch) }
    })
  } catch {
    if (version === checkVersion) items.value = items.value.map(item => item.match === undefined ? { ...item, match: {} as DuplicateMatch } : item)
  } finally { if (version === checkVersion) checking.value = false }
}
function removeItem(key: string) { items.value = items.value.filter(item => item.key !== key) }
function pickLibrary(material: Material) {
  showPicker.value = false
  if (!items.value.some(item => item.material?.material_id === material.material_id)) items.value.push({ key: `library:${material.material_id}`, kind: 'library', label: material.title || material.filename, material, decision: 'reuse' })
}
function selectBrowsedVideo(url: string) {
  browserOpen.value = false
  linkDraft.value = url
  addLink()
}
async function uploadFile(item: PendingItem) {
  const form = new FormData()
  form.append('file', item.file!)
  if (props.mode === 'add' && props.workspaceId) form.append('workspace_id', props.workspaceId)
  form.append('reuse', String(item.decision === 'reuse'))
  const response = await fetch(scopedUrl('/api/reading/materials'), { method: 'POST', credentials: 'include', body: form })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `上传失败：HTTP ${response.status}`)
  return String(result.material_id || result.material?.material_id || '')
}
async function submit() {
  if (working.value || !items.value.length) return
  working.value = true
  error.value = ''
  try {
    const urls = items.value.filter(item => item.url).map(item => item.url!)
    if (urls.length) await post('/api/reading/library/import-urls', { urls, ...(props.mode === 'add' && props.workspaceId ? { workspace_id: props.workspaceId } : { workspace_title: items.value[0].label.slice(0, 80) }) })
    const ids: string[] = []
    for (const item of items.value) {
      if (item.kind === 'library' && item.material) ids.push(item.material.material_id)
      else if (item.match?.material && item.decision === 'reuse') ids.push(item.match.material.material_id)
      else if (item.file) ids.push(await uploadFile(item))
    }
    if (props.mode === 'add' && props.workspaceId) for (const id of ids.filter(Boolean)) await post(`/api/reading/workspaces/${encodeURIComponent(props.workspaceId)}/materials`, { material_id: id, make_active: false })
    emit('done')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导入失败' }
  finally { working.value = false }
}
function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && !working.value) { event.preventDefault(); emit('close') } }
onMounted(async () => {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', keydown)
  void nextTick(() => dialog.value?.focus())
  try { library.value = (await api<{ materials: Material[] }>('/api/reading/library/materials')).materials }
  catch { library.value = [] }
})
onBeforeUnmount(() => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown) })
</script>

<template>
  <Teleport to="body"><div class="reading-dialog-overlay add-materials-overlay" @mousedown.self="!working && emit('close')"><section ref="dialog" class="add-materials-dialog" role="dialog" aria-modal="true" :aria-label="heading" tabindex="-1">
    <header class="add-materials-header"><div><h2>{{ heading }}</h2><p>{{ mode === 'add' ? '文件、链接和资料库中已有的内容。' : '上传的内容会保留在资料库中，之后可加入任意资料组。' }}</p></div><button aria-label="关闭" :disabled="working" @click="emit('close')"><LegacyIcon name="close" :size="15" /></button></header>
    <div class="add-materials-body">
      <div v-if="browserOpen" class="add-materials-browser-overlay">
        <WatchingBrowser @close="browserOpen = false" @select="selectBrowsedVideo" />
      </div>
      <input ref="fileInput" class="visually-hidden" type="file" multiple :accept="ACCEPT" @change="addFiles([...(($event.target as HTMLInputElement).files || [])]); ($event.target as HTMLInputElement).value = ''">
      <div class="add-materials-drop" :class="{ 'is-dragging': dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop="onDrop">
        <button type="button" class="add-materials-file-button" @click="fileInput?.click()"><LegacyIcon name="attachment" :size="19" /><strong>拖入 PDF、EPUB、Word、幻灯片、音频或视频</strong><span>或点击选择文件</span></button>
        <div class="add-materials-link"><LegacyIcon name="network" :size="13" /><input v-model="linkDraft" aria-label="网页或视频链接" placeholder="粘贴网页、视频或播客链接，回车添加" @keydown.enter.prevent="addLink" @blur="addLink"><button type="button" @click="browserOpen = true">浏览视频</button></div>
      </div>
      <button class="add-materials-library-toggle" :aria-expanded="showPicker" @click="showPicker = !showPicker"><LegacyIcon name="resources" :size="14" />从资料库选择<span>{{ showPicker ? '收起' : '展开' }}</span></button>
      <div v-if="showPicker" class="add-materials-picker"><input v-model="pickerQuery" type="search" aria-label="搜索已有资料" placeholder="搜索已有资料"><button v-for="material in visibleLibrary" :key="material.material_id" @click="pickLibrary(material)"><LegacyIcon name="document" :size="14" /><span><strong>{{ material.title || material.filename }}</strong><small>{{ material.source_kind }}<template v-if="material.size_bytes"> · {{ formatBytes(material.size_bytes) }}</template></small></span><LegacyIcon name="plus" :size="13" /></button><p v-if="!visibleLibrary.length">没有匹配的已有资料。</p></div>
      <div v-if="items.length" class="add-materials-pending"><article v-for="item in items" :key="item.key"><div class="add-materials-pending-main"><LegacyIcon :name="item.kind === 'url' ? 'network' : item.kind === 'library' ? 'bookmark' : 'document'" :size="15" /><div><strong>{{ item.label }}</strong><small v-if="item.sizeBytes">{{ formatBytes(item.sizeBytes) }}</small><small v-else-if="item.kind === 'library'">资料库已有内容</small><small v-else>链接</small></div><button :aria-label="`移除 ${item.label}`" :disabled="working" @click="removeItem(item.key)"><LegacyIcon name="close" :size="13" /></button></div><div v-if="item.match?.material" class="add-materials-duplicate"><p>{{ item.match.kind === 'same_name' ? '发现同名资料，可以复用已有内容，也可以另存一份。' : '这份内容已经在资料库中。' }}</p><div><button :class="{ active: item.decision === 'reuse' }" @click="item.decision = 'reuse'">复用已有</button><button :class="{ active: item.decision === 'separate' }" @click="item.decision = 'separate'">作为新资料</button></div></div></article></div>
      <p v-if="checking" class="add-materials-checking">正在检查重复内容…</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
    <footer class="add-materials-footer"><span>{{ items.length ? `${items.length} 项待导入` : '选择文件、链接或已有资料' }}</span><div><button :disabled="working" @click="emit('close')">取消</button><button class="primary" :disabled="working || !items.length" @click="submit">{{ working ? '正在导入…' : mode === 'add' ? '添加资料' : '上传资料' }}</button></div></footer>
  </section></div></Teleport>
</template>
