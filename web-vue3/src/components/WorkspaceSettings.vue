<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { api, post } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import WorkspaceRow from './WorkspaceRow.vue'
import WorkspaceResourcePicker from './WorkspaceResourcePicker.vue'
interface Row { workspace_id: string; kind: 'system' | 'general' | 'workspace'; follows_root: boolean; display_name: string; path: string; archived: boolean; status: 'ready' | 'invalid'; error: string; instructions?: string; resources?: { skills: string[] | null; mcp: string[] | null; knowledge_bases: string[] | null } }
interface Catalog { root: string; workspaces: Row[] }
const props = defineProps<{ language?: string }>()
const tr = (zh: string, en: string) => props.language === 'en' ? en : zh
const catalog = ref<Catalog | null>(null)
const root = ref('')
const creating = ref(false)
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const draft = reactive({ display_name: '', path: '', instructions: '', resources: { skills: null, mcp: null, knowledge_bases: null } })
const custom = computed(() => catalog.value?.workspaces.filter(row => row.kind === 'workspace') ?? [])
const builtIn = computed(() => catalog.value?.workspaces.filter(row => row.kind !== 'workspace') ?? [])
let loadVersion = 0
async function refresh() {
  const version = ++loadVersion
  const next = await api<Catalog>('/api/settings/workspace/registrations')
  if (version !== loadVersion) return
  catalog.value = next
  root.value = next.root || ''
  error.value = ''
}
async function load() {
  loading.value = true
  error.value = ''
  try { await refresh() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '' + tr('工作区加载失败', 'Failed to load workspaces') + '' }
  finally { loading.value = false }
}
onMounted(load)
onUnmounted(() => { loadVersion++ })
async function run(action: () => Promise<unknown>) { busy.value = true; error.value = ''; notice.value = ''; try { await action(); await refresh(); notice.value = '' + tr('工作区已更新', 'Workspace updated') + ''; return true } catch (cause) { error.value = cause instanceof Error ? cause.message : '' + tr('操作失败', 'Operation failed') + ''; return false } finally { busy.value = false } }
async function create() { if (!draft.display_name.trim()) return; if (await run(() => post('/api/settings/workspace/registrations', { name: draft.display_name.trim(), ...(draft.path.trim() ? { path: draft.path.trim() } : {}), ...(draft.instructions.trim() ? { instructions: draft.instructions.trim() } : {}), resources: draft.resources }))) { Object.assign(draft, { display_name: '', path: '', instructions: '', resources: { skills: null, mcp: null, knowledge_bases: null } }); creating.value = false } }
async function migrateRoot() { if (root.value.trim() && root.value.trim() !== catalog.value?.root) await run(() => post('/api/settings/workspace/registrations/migrate-root', { path: root.value.trim() })) }
</script>
<template><div><header class="legacy-settings-page-header workspace-page-heading"><div><h1>{{ tr('工作区', 'Workspaces') }}</h1><p>{{ tr('将对话、学习资料和进度按工作区整理。', 'Keep conversations, learning materials and progress together in one workspace.') }}</p></div><button class="primary" :disabled="busy || !catalog" @click="creating = !creating"><LegacyIcon name="plus" :size="14" />{{ tr('新建工作区', 'New workspace') }}</button></header><p v-if="error" class="error" role="alert">{{ error }} <button v-if="!catalog" @click="load">{{ tr('重试', 'Retry') }}</button></p><p v-if="notice || busy" class="notice" role="status">{{ busy ? tr('正在处理，迁移会复制并验证文件，请稍候…', 'Processing. Migration copies and verifies files; please wait…') : notice }}</p><p v-if="loading && !catalog" class="legacy-settings-loading">{{ tr('加载中…', 'Loading…') }}</p><fieldset v-if="catalog" :disabled="busy"><section class="legacy-setting-section"><header><h2>{{ tr('自建工作区', 'Custom workspaces') }}</h2><p>{{ tr('书籍、精通路径、阅读、观看和对话按工作区隔离。', 'Books, mastery paths, reading, viewing, and conversations are separated by workspace.') }}</p></header><div class="legacy-setting-section-body"><form v-if="creating" class="workspace-create-form" @submit.prevent="create"><label>{{ tr('工作区名称', 'Workspace name') }}<input v-model="draft.display_name" required maxlength="100" :placeholder="tr('例如：概率论', 'For example: Probability Theory')"></label><label>{{ tr('现有目录（可选）', 'Existing directory (optional)') }}<input v-model="draft.path" :placeholder="tr('留空则在根目录下创建', 'Leave blank to create under the root directory')"></label><p class="muted">{{ tr('将文件放入目录供智能体读取，生成文件写入 outputs/。', 'Place files in the directory for the agent to read. Generated files go to outputs/.') }}</p><label>{{ tr('工作区说明', 'Workspace instructions') }}<textarea v-model="draft.instructions" rows="3" :placeholder="tr('此工作区的目标、约定和输出要求。', 'Goals, conventions, and output requirements for this workspace.')" /></label><WorkspaceResourcePicker v-model="draft.resources" :language="language" /><div><button class="primary" :disabled="!draft.display_name.trim()">{{ tr('创建工作区', 'Create workspace') }}</button><button type="button" @click="creating = false">{{ tr('取消', 'Cancel') }}</button></div></form><WorkspaceRow v-for="row in custom" :key="row.workspace_id" :row="row" :busy="busy" :language="language" :run="run" /><div v-if="!custom.length && !creating" class="workspace-empty"><LegacyIcon name="folder" :size="28" /><p>{{ tr('为主题或项目创建工作区，让相关对话共享其中的文件。', 'Create a workspace for a topic or project so related conversations can share its files.') }}</p></div></div></section><section class="legacy-setting-section"><h2>{{ tr('内置工作区', 'Built-in workspaces') }}</h2><div class="legacy-setting-section-body"><WorkspaceRow v-for="row in builtIn" :key="row.workspace_id" :row="row" :busy="busy" :language="language" :run="run" /></div></section><section class="legacy-setting-section"><header><h2>{{ tr('存储位置', 'Storage location') }}</h2><p>{{ tr('工作区默认位于“根目录 / 工作区 ID”。更改根目录会迁移跟随根目录的文件夹，自定义位置不变；远程部署使用服务器目录。', 'Workspaces default to root directory / workspace ID. Changing the root migrates folders that follow it; custom locations stay unchanged. Remote deployments use server directories.') }}</p></header><div class="legacy-setting-section-body"><form class="workspace-root-form" @submit.prevent="migrateRoot"><label>{{ tr('工作区根目录', 'Workspace root directory') }}<input v-model="root" required @keydown.enter.prevent="migrateRoot"></label><div v-if="root.trim() !== catalog?.root"><button class="primary" :disabled="!root.trim()">{{ tr('迁移到新根目录', 'Migrate to new root') }}</button><p class="muted">{{ tr('旧目录会保留为备份，请先完成正在进行的对话。', 'The old directory is kept as a backup. Finish active conversations first.') }}</p></div></form></div></section></fieldset></div></template>
