<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api, post } from '../api'
import MarkdownView from '../components/MarkdownView.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import { isValidResourceName, slugifyResourceName } from '../resourceName'

interface Persona { name: string; description: string; source: 'user' | 'admin'; read_only: boolean; content?: string }
const personas = ref<Persona[]>([])
const search = ref('')
const selected = ref<Persona | null>(null)
const detailLoading = ref(false)
const editing = ref(false)
const originalName = ref('')
const name = ref('')
const description = ref('')
const content = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const personaMenuOpen = ref(false)
let detailVersion = 0
let mounted = true
const filtered = computed(() => personas.value.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(search.value.toLowerCase())))
async function load() {
  loading.value = true
  error.value = ''
  try { personas.value = (await api<{ personas: Persona[] }>('/api/personas')).personas }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Personas 加载失败' }
  finally { loading.value = false }
}
onMounted(load)
onUnmounted(() => { mounted = false; detailVersion++ })
function create() {
  detailVersion++
  selected.value = null
  originalName.value = ''
  name.value = ''
  description.value = ''
  content.value = '# My Persona\n\nDescribe the tone, attitude, and communication style the assistant should adopt.\n'
  editing.value = true
  error.value = ''
}
async function getDetail(item: Persona) {
  const version = ++detailVersion
  detailLoading.value = true
  error.value = ''
  try {
    const detail = await api<Persona>(`/api/personas/${encodeURIComponent(item.name)}`)
    if (mounted && version === detailVersion) return detail
  } catch (cause) {
    if (version === detailVersion) error.value = cause instanceof Error ? cause.message : '读取 Persona 失败'
  } finally {
    if (version === detailVersion) detailLoading.value = false
  }
  return null
}
async function show(item: Persona) {
  editing.value = false
  selected.value = { ...item, content: '' }
  const detail = await getDetail(item)
  if (detail && selected.value?.name === item.name) selected.value = detail
}
async function edit(item: Persona) {
  if (item.read_only) return
  selected.value = { ...item, content: '' }
  const detail = await getDetail(item)
  if (!detail) return
  originalName.value = item.name
  name.value = detail.name
  description.value = detail.description
  content.value = detail.content || ''
  editing.value = true
}
function updateName(value: string) { name.value = slugifyResourceName(value) }
async function save() {
  const target = name.value.trim()
  if (!isValidResourceName(target)) { error.value = '名称须由小写字母、数字和连字符组成，最长 64 字符。'; return }
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    if (originalName.value) await api(`/api/personas/${encodeURIComponent(originalName.value)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: description.value, content: content.value, ...(target !== originalName.value ? { rename_to: target } : {}) }) })
    else await post('/api/personas', { name: target, description: description.value, content: content.value })
    editing.value = false
    selected.value = null
    await load()
    notice.value = 'Persona 已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
async function remove(item: Persona) {
  if (item.read_only || !confirm(`删除 Persona“${item.name}”？`)) return
  busy.value = true
  error.value = ''
  try {
    await api(`/api/personas/${encodeURIComponent(item.name)}`, { method: 'DELETE' })
    if (selected.value?.name === item.name) selected.value = null
    await load()
    notice.value = 'Persona 已删除'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="feature-page resource-page">
    <nav class="persona-page-bar" aria-label="位置"><div class="persona-crumb-wrap"><button type="button" class="persona-crumb" aria-haspopup="menu" :aria-expanded="personaMenuOpen" @click.stop="personaMenuOpen = !personaMenuOpen" @keydown.esc="personaMenuOpen = false"><span aria-hidden="true"><LegacyIcon name="profile" :size="14" /></span>Personas</button><template v-if="personaMenuOpen"><div class="persona-menu-dismiss" @click="personaMenuOpen = false"></div><div class="persona-resource-menu" role="menu" aria-label="个性化"><p>个性化</p><RouterLink role="menuitem" to="/personalization" @click="personaMenuOpen = false">全部个性化</RouterLink><RouterLink role="menuitem" to="/agents" @click="personaMenuOpen = false">子智能体</RouterLink><RouterLink role="menuitem" class="is-active" to="/space/personas" @click="personaMenuOpen = false">Personas</RouterLink><RouterLink role="menuitem" to="/space/skills" @click="personaMenuOpen = false">技能</RouterLink><RouterLink role="menuitem" to="/space/mcp" @click="personaMenuOpen = false">MCP 服务</RouterLink><RouterLink role="menuitem" to="/space/cli-apps" @click="personaMenuOpen = false">CLI 应用</RouterLink><RouterLink role="menuitem" to="/memory" @click="personaMenuOpen = false">记忆</RouterLink></div></template></div><span class="persona-count-pill">{{ filtered.length }} 个人格</span><button type="button" class="persona-new-button" @click="create">＋ 新建人格</button></nav>
    <div class="persona-page-content"><RouterLink to="/personalization" class="text-button">← 个性化</RouterLink>
    <header class="feature-heading"><div><h1>人格</h1><p>用于设定助手语气和风格的行为预设，可在输入框中为每轮对话选择一个。</p></div><button type="button" class="primary" @click="create">新建人格</button></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="loading" class="muted" role="status">加载中…</p>
    <div class="resource-card-grid"><article v-for="item in filtered" :key="item.name" class="resource-item-card partner-card" role="button" tabindex="0" @click="show(item)" @keydown.enter="show(item)"><div class="resource-item-heading"><span class="resource-item-icon"><LegacyIcon name="profile" :size="13" /></span><div><div class="resource-title-line"><strong>{{ item.name }}</strong><span v-if="item.source === 'admin'" class="persona-preset-badge">预设</span></div><p>{{ item.description || '暂无描述' }}</p></div><div class="resource-item-actions partner-actions"><button v-if="!item.read_only" class="legacy-sr-only" @click.stop="edit(item)">编辑</button><button v-if="!item.read_only" class="legacy-sr-only" :disabled="busy" @click.stop="remove(item)">删除</button><button aria-label="查看" title="查看" @click.stop="show(item)">查看</button><button v-if="!item.read_only" title="编辑" @click.stop="edit(item)">✎</button><button v-if="!item.read_only" title="删除" :disabled="busy" @click.stop="remove(item)">⌫</button></div></div><span v-if="item.read_only" class="legacy-sr-only" aria-hidden="true">只读</span></article></div></div><p v-if="!loading && !filtered.length" class="resource-empty">暂无匹配的 Persona。</p><div v-if="selected && !editing" class="resource-modal-overlay" @click.self="selected = null"><section class="resource-modal resource-detail" role="dialog" aria-modal="true" :aria-label="selected.name"><header><div><h2>{{ selected.name }}</h2><p>{{ selected.description }}</p></div><div><button v-if="!selected.read_only" @click="edit(selected)">✎ 编辑</button><button aria-label="关闭" @click="selected = null">×</button></div></header><div class="resource-modal-body"><p v-if="detailLoading" role="status">加载中…</p><MarkdownView v-else :content="selected.content || ''" strip-frontmatter /></div></section></div><div v-if="editing" class="resource-modal-overlay" @click.self="editing = false"><section class="resource-modal resource-editor-modal resource-editor" role="dialog" aria-modal="true" :aria-label="originalName ? '编辑 Persona' : '新建 Persona'"><header><h2>{{ originalName ? '编辑 Persona' : '新建 Persona' }}</h2><button aria-label="取消" @click="editing = false">×</button></header><form class="settings-form" @submit.prevent="save"><label>名称<input :value="name" required maxlength="64" pattern="[a-z0-9][a-z0-9-]{0,63}" placeholder="patient-tutor" @input="updateName(($event.target as HTMLInputElement).value)"><small>仅限小写字母、数字和连字符。</small></label><label>描述<input v-model="description" placeholder="在选择器中显示的简短说明"></label><label>内容（Markdown）<textarea v-model="content" rows="14" required spellcheck="false" /></label><p class="muted">YAML frontmatter 可选，名称和描述由系统自动管理。</p><div class="resource-modal-actions"><button type="button" @click="editing = false">取消</button><button class="primary" :disabled="busy">{{ busy ? '保存中…' : '保存' }}</button></div></form></section></div>
  </main>
</template>
