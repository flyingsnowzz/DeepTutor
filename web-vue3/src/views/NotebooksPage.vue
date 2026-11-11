<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, post } from '../api'
import { scopedUrl } from '../workspaceScope'
import FolderGlyph from '../components/FolderGlyph.vue'
import NotebookRecordCard from '../components/NotebookRecordCard.vue'

interface Notebook { id: string; name: string; description?: string; color?: string; record_count?: number; updated_at?: number; unreadable?: boolean }
interface RecordItem { id: string; type: string; title: string; summary?: string; user_query?: string; output?: string; kb_name?: string | null; created_at?: number; metadata?: Record<string, unknown> }
interface Detail extends Notebook { records: RecordItem[] }
const route = useRoute()
const router = useRouter()
const notebooks = ref<Notebook[]>([])
const detail = ref<Detail | null>(null)
const name = ref('')
const description = ref('')
const newName = ref('')
const newDescription = ref('')
const search = ref('')
const resourceMenuOpen = ref(false)
const recordSearch = ref('')
const recordKind = ref('')
const error = ref('')
const notice = ref('')
const busy = ref(false)
const loading = ref(true)
const editing = ref(false)
const metaMode = ref<'create' | 'edit' | null>(null)
const color = ref('#6366F1')
const deleteOpen = ref(false)
const peeks = ref<Record<string, RecordItem[]>>({})
const swatches = ['#6366F1', '#4F86F7', '#1FB5A8', '#43B05C', '#EAA221', '#F07B3F', '#E8577A', '#8E6CF0', '#6B7A90']
const focusedRecord = ref('')
let loadVersion = 0
const filteredNotebooks = computed(() => notebooks.value.filter(book => `${book.name} ${book.description || ''}`.toLowerCase().includes(search.value.toLowerCase())))
const recordTypes = computed(() => [...new Set((detail.value?.records || []).map(record => record.type))])
const filteredRecords = computed(() => (detail.value?.records || []).filter(record => record.id === focusedRecord.value || ((!recordKind.value || record.type === recordKind.value) && `${record.title} ${record.summary || ''} ${record.output || ''}`.toLowerCase().includes(recordSearch.value.toLowerCase()))))
function targets() { return notebooks.value.filter(book => !book.unreadable && book.id !== detail.value?.id) }
async function locateRequestedRecord(id: string, requestedRecord: string) {
  if (!requestedRecord || !detail.value) { focusedRecord.value = ''; return }
  if (detail.value.records.some(record => record.id === requestedRecord)) {
    focusedRecord.value = requestedRecord
    await nextTick()
    document.getElementById(`notebook-record-${requestedRecord}`)?.scrollIntoView({ block: 'start' })
    return
  }
  try {
    const location = await api<{ notebook_id: string }>(`/api/notebooks/records/${encodeURIComponent(requestedRecord)}/location?notebook_id=${encodeURIComponent(id)}`)
    if (location.notebook_id && location.notebook_id !== id) {
      await router.replace({ path: `/notebooks/${encodeURIComponent(location.notebook_id)}`, query: { record: requestedRecord } })
    } else error.value = '这条收藏内容已不可用。'
  } catch { error.value = '无法定位这条收藏内容，请重新打开来源链接。' }
}
async function load() {
  const version = ++loadVersion
  loading.value = true
  error.value = ''
  try {
    const list = await api<{ notebooks: Notebook[] }>('/api/notebooks')
    if (version !== loadVersion) return
    notebooks.value = list.notebooks ?? []
    void Promise.all(notebooks.value.filter(book => !book.unreadable).map(async book => { try { const result = await api<Detail>(`/api/notebooks/${encodeURIComponent(book.id)}`); peeks.value[book.id] = (result.records || []).slice(0, 3) } catch { /* A failed preview leaves the folder itself usable. */ } }))
    const id = String(route.params.notebookId || '')
    if (!id) { detail.value = null; focusedRecord.value = ''; return }
    const summary = notebooks.value.find(book => book.id === id)
    if (summary?.unreadable) { detail.value = null; error.value = '收藏夹文件无法读取，原始数据已保留。'; return }
    const result = await api<Detail>(`/api/notebooks/${encodeURIComponent(id)}`)
    if (version !== loadVersion) return
    detail.value = result
    name.value = result.name
    description.value = result.description ?? ''
    await locateRequestedRecord(id, String(route.query.record || ''))
  } catch (cause) { if (version === loadVersion) { detail.value = null; error.value = cause instanceof Error ? cause.message : '收藏夹加载失败' } }
  finally { if (version === loadVersion) loading.value = false }
}
watch(() => [route.params.notebookId, route.query.record], () => { resourceMenuOpen.value = false; void load() }, { immediate: true })
async function create() {
  if (!newName.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await post<{ notebook: Notebook }>('/api/notebooks', { name: newName.value.trim(), description: newDescription.value, ...(color.value !== '#6366F1' ? { color: color.value } : {}) })
    newName.value = ''
    newDescription.value = ''
    metaMode.value = null
    await router.push(`/notebooks/${encodeURIComponent(result.notebook.id)}`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败' }
  finally { busy.value = false }
}
async function save() {
  if (!detail.value || !name.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    await api(`/api/notebooks/${encodeURIComponent(detail.value.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.value.trim(), description: description.value, color: color.value }) })
    editing.value = false
    metaMode.value = null
    await load()
    notice.value = '收藏夹已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
async function removeNotebook() {
  if (!detail.value) return
  busy.value = true
  try { await api(`/api/notebooks/${encodeURIComponent(detail.value.id)}`, { method: 'DELETE' }); await router.push('/notebooks') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busy.value = false }
}
function openCreateNotebook() { newName.value = ''; newDescription.value = ''; color.value = '#6366F1'; metaMode.value = 'create' }
function openEditNotebook() { if (!detail.value) return; name.value = detail.value.name; description.value = detail.value.description || ''; color.value = detail.value.color || '#6366F1'; metaMode.value = 'edit' }
function toggleRecord(recordId: string) {
  const query = { ...route.query } as Record<string, string>
  if (focusedRecord.value === recordId) delete query.record
  else query.record = recordId
  void router.replace({ path: route.path, query })
}
async function saveRecord(recordId: string, changes: { title?: string; summary?: string; output?: string }, done: (ok: boolean) => void) {
  if (!detail.value) { done(false); return }
  busy.value = true
  try {
    await api(`/api/notebooks/${encodeURIComponent(detail.value.id)}/records/${encodeURIComponent(recordId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })
    await load()
    notice.value = '收藏内容已保存'
    done(true)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存收藏内容失败'; done(false) }
  finally { busy.value = false }
}
async function removeRecord(record: RecordItem) {
  if (!detail.value) return
  busy.value = true
  try { await api(`/api/notebooks/${encodeURIComponent(detail.value.id)}/records/${encodeURIComponent(record.id)}`, { method: 'DELETE' }); await load(); notice.value = '收藏内容已删除' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '移除失败' }
  finally { busy.value = false }
}
async function relocate(record: RecordItem, mode: 'move' | 'copy', target: string) {
  if (!detail.value || !target) { error.value = '请先选择另一个收藏夹。'; return }
  busy.value = true
  try {
    await post(`/api/notebooks/${encodeURIComponent(detail.value.id)}/records/${encodeURIComponent(record.id)}/actions/${mode}`, { target_notebook_id: target })
    await load()
    notice.value = mode === 'move' ? '收藏内容已移动' : '收藏内容已复制'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '移动或复制失败' }
  finally { busy.value = false }
}
function openRecordSession(sessionId: string) { void router.push(`/chat/${encodeURIComponent(sessionId)}`) }
async function exportMarkdown() {
  if (!detail.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await fetch(scopedUrl(`/api/notebooks/${encodeURIComponent(detail.value.id)}/export`), { credentials: 'include' })
    if (!response.ok) throw new Error(`导出失败（${response.status}）`)
    const markdown = await response.text()
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${detail.value.name || detail.value.id}.md`
    anchor.click()
    URL.revokeObjectURL(url)
    notice.value = '收藏夹已导出'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导出失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="feature-page notebooks-page">
    <nav class="notebooks-page-bar" aria-label="位置">
      <div class="notebooks-crumb-wrap">
        <button type="button" class="notebooks-crumb" aria-haspopup="menu" :aria-expanded="resourceMenuOpen" @click.stop="resourceMenuOpen = !resourceMenuOpen" @keydown.esc="resourceMenuOpen = false">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
          <h1 v-if="route.params.notebookId" class="notebooks-crumb-title">{{ detail?.name || '收藏夹' }}</h1><span v-else>收藏夹</span>
        </button>
        <template v-if="resourceMenuOpen">
          <div class="notebooks-menu-dismiss" @click="resourceMenuOpen = false"></div>
          <div class="notebooks-resource-menu" role="menu" aria-label="资料">
            <p>资料</p>
            <RouterLink role="menuitem" to="/space" @click="resourceMenuOpen = false"><span aria-hidden="true">▱</span>全部资料</RouterLink>
            <RouterLink role="menuitem" to="/space/chat-history" @click="resourceMenuOpen = false"><span aria-hidden="true">↺</span>聊天历史</RouterLink>
            <RouterLink role="menuitem" class="is-active" to="/notebooks" @click="resourceMenuOpen = false"><span aria-hidden="true">♙</span>收藏夹</RouterLink>
            <RouterLink role="menuitem" to="/space/journal" @click="resourceMenuOpen = false"><span aria-hidden="true">▧</span>学习日志</RouterLink>
            <RouterLink role="menuitem" to="/space/questions" @click="resourceMenuOpen = false"><span aria-hidden="true">☑</span>题库</RouterLink>
            <RouterLink role="menuitem" to="/knowledge-bases" @click="resourceMenuOpen = false"><span aria-hidden="true">▤</span>知识中心</RouterLink>
          </div>
        </template>
      </div>
      <div class="notebooks-bar-actions">
        <button v-if="!route.params.notebookId" type="button" class="notebooks-bar-action" aria-label="创建" :aria-expanded="metaMode === 'create'" @click="newName.trim() ? create() : openCreateNotebook()"><span aria-hidden="true" class="notebooks-plus">+</span>新建收藏夹</button>
        <template v-else-if="detail">
          <button type="button" title="编辑收藏夹" aria-label="编辑收藏夹" @click="openEditNotebook">✎</button>
          <button type="button" title="导出 Markdown" aria-label="导出 Markdown" @click="exportMarkdown">⇩</button>
          <button type="button" title="删除收藏夹" aria-label="删除收藏夹" class="legacy-danger" @click="deleteOpen = true">⌫</button>
        </template>
      </div>
    </nav>
    <div class="notebooks-page-content">
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="loading" role="status">加载中…</p>
    <template v-if="!route.params.notebookId">
      <header class="notebooks-page-header">
        <span class="notebooks-page-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg></span>
        <h1>收藏夹</h1>
        <div class="notebooks-page-actions"><button class="primary" aria-label="创建" :aria-expanded="metaMode === 'create'" @click="newName.trim() ? create() : openCreateNotebook()"><span aria-hidden="true" class="notebooks-plus">+</span>新建收藏夹</button></div>
      </header>
      <form class="notebooks-compat-create" aria-hidden="true" @submit.prevent="create"><input v-model="newName" aria-label="新收藏夹名称" tabindex="-1"><input v-model="newDescription" aria-label="新收藏夹描述" tabindex="-1"></form>
      <div v-if="notebooks.length" class="notebooks-home-tools"><label><span aria-hidden="true">⌕</span><input v-model="search" type="search" aria-label="搜索收藏夹" placeholder="搜索收藏内容…"></label><span>{{ notebooks.length }} 个收藏夹 · {{ notebooks.reduce((sum, book) => sum + (book.record_count || 0), 0) }} 条记录</span></div>
      <section v-if="!filteredNotebooks.length" class="notebooks-empty"><FolderGlyph v-if="!notebooks.length" :files="0" :size="64" /><p class="notebooks-empty-title">{{ notebooks.length ? '没有匹配的收藏夹' : '还没有收藏夹。' }}</p><p v-if="!notebooks.length">在 DeepTutor 任何地方收藏对话、研究报告或题目，都可以归档到这里的收藏夹。</p><button v-if="!notebooks.length" class="primary" @click="openCreateNotebook"><span aria-hidden="true" class="notebooks-plus">+</span>新建收藏夹</button></section><ul v-else class="notebooks-grid"><li v-for="book in filteredNotebooks" :key="book.id" class="notebook-collection-card"><button class="notebook-collection-open" @click="router.push(`/notebooks/${encodeURIComponent(book.id)}`)"><span class="notebook-collection-head"><FolderGlyph :color="book.color" :files="book.record_count || 0" :size="40" /><span><strong>{{ book.name }}</strong><small>{{ book.unreadable ? '无法读取' : `${book.record_count || 0} 条记录` }}<template v-if="book.updated_at"> · {{ new Date(book.updated_at * 1000).toLocaleDateString('zh-CN') }}</template></small></span></span><span v-if="book.description" class="notebook-collection-desc">{{ book.description }}</span><span class="notebook-collection-files"><span v-for="record in peeks[book.id] || []" :key="record.id" class="notebook-collection-file">▤ {{ record.title }}</span><span v-if="(book.record_count || 0) > 3" class="notebook-collection-more">+{{ (book.record_count || 0) - 3 }} 更多</span><span v-if="!(book.record_count || 0)" class="notebook-collection-more">空收藏夹</span></span></button><button class="notebook-collection-edit" title="编辑收藏夹" @click="detail = book as Detail; openEditNotebook()">✎</button></li><li><button class="notebook-new-card" @click="openCreateNotebook">＋ 新建收藏夹</button></li></ul></template>
    <template v-else-if="detail"><header class="notebooks-detail-header"><div class="notebooks-detail-title"><FolderGlyph :color="detail.color" :files="detail.records.length" :size="38" /><div><h1>{{ detail.name }}</h1><p>{{ detail.description }}</p><small>{{ detail.records.length }} 条记录</small></div></div><div class="notebooks-detail-actions"><button title="编辑收藏夹" @click="openEditNotebook">✎</button><button title="导出 Markdown" aria-label="导出 Markdown" @click="exportMarkdown">⇩</button><button title="删除收藏夹" class="legacy-danger" @click="deleteOpen = true">⌫</button></div></header><div class="notebooks-record-tools"><label>⌕ <input v-model="recordSearch" type="search" aria-label="搜索收藏内容" placeholder="搜索这个收藏夹"></label><div v-if="recordTypes.length > 1" class="notebooks-record-chips"><button :aria-pressed="!recordKind" @click="recordKind = ''">全部</button><button v-for="kind in recordTypes" :key="kind" :aria-pressed="recordKind === kind" @click="recordKind = recordKind === kind ? '' : kind">{{ kind }}</button></div></div><p v-if="!detail.records?.length" class="notebooks-empty-records">这个收藏夹是空的。可以从对话、研究或 Co-Writer 文档保存内容。</p><p v-else-if="!filteredRecords.length" class="notebooks-empty-records">没有匹配的收藏内容。</p><div v-else class="notebooks-record-list"><NotebookRecordCard v-for="record in filteredRecords" :id="`notebook-record-${record.id}`" :key="record.id" :record="record" :notebooks="notebooks" :current-notebook-id="detail.id" :expanded="focusedRecord === record.id" :busy="busy" @toggle="toggleRecord(record.id)" @save="saveRecord" @relocate="relocate" @remove="removeRecord" @open-session="openRecordSession" /></div></template>
    </div>
    <Teleport to="body"><div v-if="metaMode" class="notebooks-dialog-overlay" @click.self="metaMode = null"><form class="notebooks-meta-dialog" role="dialog" aria-modal="true" :aria-label="metaMode === 'edit' ? '编辑收藏夹' : '新建收藏夹'" @submit.prevent="metaMode === 'edit' ? save() : create()"><div class="notebooks-meta-preview"><FolderGlyph :color="color" :files="metaMode === 'edit' ? detail?.records.length || 0 : 0" :size="72" /></div><h2>{{ metaMode === 'edit' ? '编辑收藏夹' : '新建收藏夹' }}</h2><label>收藏夹名称<input v-if="metaMode === 'edit'" v-model="name" aria-label="收藏夹名称" required autofocus><input v-else v-model="newName" aria-label="新收藏夹名称" placeholder="例如：热力学、考前复习" required autofocus></label><label>描述（可选）<input v-if="metaMode === 'edit'" v-model="description" aria-label="描述" placeholder="这个收藏夹放什么"><input v-else v-model="newDescription" aria-label="新收藏夹描述" placeholder="这个收藏夹放什么"></label><fieldset><legend>颜色</legend><div class="notebooks-color-options" role="radiogroup" aria-label="颜色"><button v-for="swatch in swatches" :key="swatch" type="button" role="radio" :style="{ background: swatch }" :class="{ selected: color === swatch }" :aria-label="swatch" :aria-checked="color === swatch" @click="color = swatch"></button></div></fieldset><div class="notebooks-dialog-actions"><button type="button" @click="metaMode = null">取消</button><button class="primary" :disabled="busy || !(metaMode === 'edit' ? name.trim() : newName.trim())">{{ metaMode === 'edit' ? '保存' : '创建' }}</button></div></form></div></Teleport>
    <Teleport to="body"><div v-if="deleteOpen" class="notebooks-dialog-overlay" @click.self="deleteOpen = false"><section class="notebooks-delete-dialog" role="alertdialog" aria-modal="true"><h2>删除收藏夹？</h2><p>“{{ detail?.name }}”及其中 {{ detail?.records.length || 0 }} 条记录将被删除，此操作无法撤销。</p><div class="notebooks-dialog-actions"><button @click="deleteOpen = false">取消</button><button class="primary" :disabled="busy" @click="removeNotebook">永久删除</button></div></section></div></Teleport>
  </main>
</template>
