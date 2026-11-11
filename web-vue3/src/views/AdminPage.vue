<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, authStatus, post } from '../api'
import AdminLearnerProfile from './AdminLearnerProfile.vue'
import UserAvatar from '../components/UserAvatar.vue'
import AdminBookPermission from './AdminBookPermission.vue'
import AdminGrantEditor from './AdminGrantEditor.vue'
import AdminGuardianRelationships from './AdminGuardianRelationships.vue'

type Administrator = { id: string; username: string; super_admin: boolean }
type User = { id: string; username: string; role?: string; preset?: string; created_at?: string; avatar?: string }
type BatchResult = { deleted_count: number; failed_count: number; results: { username: string; ok: boolean; error?: string }[] }
type ImportResult = { created_count: number; failed_count: number; results: { row: number; username: string; ok: boolean; error?: string }[] }
const props = defineProps<{ mode: 'accounts' | 'users' }>()
const router = useRouter()
const rows = ref<Administrator[] | User[]>([])
const username = ref('')
const password = ref('')
const preset = ref<'standard' | 'learner' | 'custom'>('standard')
const query = ref('')
const selected = ref<string[]>([])
const importFile = ref<File | null>(null)
const importResult = ref<ImportResult | null>(null)
const currentUser = ref('')
const expandedUserId = ref<string | null>(null)
const message = ref('')
const error = ref('')
const busy = ref(false)
const showCreateDialog = ref(false)
const showImportDialog = ref(false)
const deleteTarget = ref<User | null>(null)
const batchDeleteConfirm = ref(false)
const superAdmin = ref(false)
const title = computed(() => props.mode === 'accounts' ? '管理员' : '用户')
const users = computed(() => props.mode === 'users' ? rows.value as User[] : [])
const filteredUsers = computed(() => users.value.filter(user => `${user.username} ${user.role || ''} ${user.preset || ''}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const selectableUsers = computed(() => filteredUsers.value.filter(user => user.username !== currentUser.value))
function roleLabel(role?: string) { return role === 'admin' ? '管理员' : '用户' }
function presetLabel(preset?: string) { return preset === 'learner' ? '学习者' : preset === 'custom' ? '自定义' : '标准' }
function formatJoined(value?: string) { return value ? new Date(value).toLocaleDateString('zh-CN') : '—' }
const allSelected = computed(() => selectableUsers.value.length > 0 && selectableUsers.value.every(user => selected.value.includes(user.username)))

async function load() {
  error.value = ''
  try {
    const status = await authStatus()
    if (!status.authenticated || !status.is_admin) {
      await router.replace('/admin/login')
      return
    }
    superAdmin.value = Boolean(status.is_super_admin)
    currentUser.value = status.username || ''
    if (props.mode === 'accounts') {
      if (!superAdmin.value) {
        await router.replace('/admin/users')
        return
      }
      rows.value = (await api<{ administrators: Administrator[] }>('/api/auth/admin/accounts')).administrators
    } else {
      rows.value = await api<User[]>('/api/auth/users')
      selected.value = selected.value.filter(name => users.value.some(user => user.username === name))
      if (expandedUserId.value && !users.value.some(user => user.id === expandedUserId.value)) expandedUserId.value = null
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载失败' }
}
onMounted(() => { void load() })
watch(() => props.mode, () => { selected.value = []; void load() })
async function create() {
  if (!username.value.trim()) { error.value = '请输入用户名'; return }
  if (password.value.length < 8) { error.value = '密码至少需要 8 个字符'; return }
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await post(props.mode === 'accounts' ? '/api/auth/admin/accounts' : '/api/auth/users', {
      username: username.value, password: password.value,
      ...(props.mode === 'users' ? { preset: preset.value } : {}),
    })
    username.value = ''; password.value = ''
    if (props.mode === 'users') showCreateDialog.value = false
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败' }
  finally { busy.value = false }
}
function openCreate() { username.value = ''; password.value = ''; preset.value = 'standard'; error.value = ''; showCreateDialog.value = true }
function openImport() { importFile.value = null; importResult.value = null; error.value = ''; showImportDialog.value = true }
function remove(user: User) { deleteTarget.value = user }
async function confirmRemove() {
  const user = deleteTarget.value
  if (!user) return
  busy.value = true
  try {
    await api(`/api/auth/users/${encodeURIComponent(user.username)}`, { method: 'DELETE' })
    message.value = `已删除 ${user.username}`
    deleteTarget.value = null
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
  finally { busy.value = false }
}
function toggleAll() {
  const names = selectableUsers.value.map(user => user.username)
  selected.value = allSelected.value ? selected.value.filter(name => !names.includes(name)) : [...new Set([...selected.value, ...names])]
}
function removeSelected() { if (selected.value.length) batchDeleteConfirm.value = true }
async function confirmRemoveSelected() {
  if (!selected.value.length) return
  busy.value = true
  error.value = ''
  try {
    const result = await post<BatchResult>('/api/auth/users/batch-delete', { usernames: selected.value })
    selected.value = result.results.filter(row => !row.ok).map(row => row.username)
    await load()
    message.value = `已删除 ${result.deleted_count} 个用户`
    if (result.failed_count) error.value = `${result.failed_count} 个用户删除失败：${result.results.filter(row => !row.ok).map(row => `${row.username}（${row.error || '失败'}）`).join('、')}`
    batchDeleteConfirm.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '批量删除失败' }
  finally { busy.value = false }
}
async function importUsers() {
  if (!importFile.value) return
  busy.value = true
  error.value = ''
  importResult.value = null
  try {
    const form = new FormData()
    form.append('file', importFile.value)
    importResult.value = await api<ImportResult>('/api/auth/users/import', { method: 'POST', body: form })
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导入失败' }
  finally { busy.value = false }
}
async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => null)
  await router.replace('/admin/login')
}
</script>

<template>
  <main v-if="mode === 'users'" class="admin-page admin-users-page">
    <div class="admin-content">
      <template v-if="mode === 'users'"><RouterLink to="/chat" class="admin-back">← 返回</RouterLink><header class="admin-users-header"><div><h1>用户管理</h1><p>管理已注册账号</p></div><div class="admin-header-actions"><RouterLink v-if="superAdmin" to="/admin/accounts">管理员</RouterLink><button type="button" aria-label="添加用户" @click="openCreate">＋ 添加用户</button><button type="button" @click="openImport">⇧ 导入用户</button><button type="button" :disabled="busy" @click="load">↻ 刷新</button></div></header></template>
      <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" class="notice" role="status">{{ message }}</p>
      <div v-if="mode === 'users'" class="admin-toolbar"><input v-model="query" type="search" aria-label="搜索用户" placeholder="搜索用户…" /><span>{{ query.trim() ? `${filteredUsers.length} / ${users.length}` : `${users.length} 个用户` }}</span></div>
      <div v-if="mode === 'users' && selected.length" class="admin-toolbar admin-selection-bar"><span>已选择 {{ selected.length }} 个用户</span><button type="button" @click="selected = []">清除选择</button><button type="button" class="danger" :disabled="busy" @click="removeSelected">删除选中</button></div>
      <div class="record-list">
        <div v-if="mode === 'users'" class="record-row admin-user-heading"><input type="checkbox" :checked="allSelected" :disabled="!selectableUsers.length" aria-label="选择当前显示的用户" @change="toggleAll" /><span>用户名</span><span>角色</span><span>创建时间</span><span>操作</span></div>
        <template v-if="mode === 'users'"><template v-for="row in filteredUsers" :key="row.id"><div class="record-row admin-user-row"><input type="checkbox" :checked="selected.includes(row.username)" :disabled="row.username === currentUser" :aria-label="`选择 ${row.username}`" @change="selected = selected.includes(row.username) ? selected.filter(name => name !== row.username) : [...selected, row.username]" /><span class="admin-user-identity"><UserAvatar :username="row.username" :user-id="row.id" :avatar="row.avatar" :role="row.role" :size="32" /><strong>{{ row.username }}<small v-if="row.username === currentUser">（你）</small></strong></span><span><i class="admin-role-badge" :class="{ admin: row.role === 'admin' }">{{ row.role === 'admin' ? '♙ ' : '' }}{{ roleLabel(row.role) }}</i><small v-if="row.role !== 'admin' && row.preset" class="admin-preset-label">预设：{{ presetLabel(row.preset) }}</small></span><span class="admin-joined">{{ formatJoined(row.created_at) }}</span><div class="admin-row-actions"><button v-if="row.role !== 'admin'" type="button" title="分配权限" aria-label="分配权限" :aria-expanded="expandedUserId === row.id" @click="expandedUserId = expandedUserId === row.id ? null : row.id">⚒</button><button type="button" title="删除" aria-label="删除" :disabled="row.username === currentUser" @click="remove(row)">⌫</button></div></div><div v-if="expandedUserId === row.id && row.role !== 'admin'" class="admin-user-expanded"><AdminGrantEditor :user-id="row.id" :learner="row.preset === 'learner'" /><AdminBookPermission :user-id="row.id" /><AdminGuardianRelationships v-if="row.preset === 'learner'" :learner-id="row.id" :learner-username="row.username" :users="users" /><AdminLearnerProfile v-if="row.preset === 'learner'" :username="row.username" /></div></template></template>
        <p v-if="mode === 'users' ? filteredUsers.length === 0 : rows.length === 0">{{ query && mode === 'users' ? '没有匹配的用户' : '暂无记录' }}</p>
      </div>
      <p v-if="mode === 'users'" class="admin-users-footer">DeepTutor 管理后台 · 用户管理</p>
    </div>
    <div v-if="showCreateDialog" class="admin-dialog-overlay" @click.self="showCreateDialog = false"><form class="admin-dialog admin-user-dialog" role="dialog" aria-modal="true" aria-label="添加用户" @submit.prevent="create"><header><h2>添加用户</h2><button type="button" aria-label="关闭" @click="showCreateDialog = false">×</button></header><label>用户名<input v-model.trim="username" required autocomplete="off" placeholder="用户名" autofocus></label><label>密码<input v-model="password" type="password" minlength="8" required autocomplete="new-password" placeholder="密码（至少 8 位）"></label><fieldset><legend>账号预设</legend><div class="admin-preset-options" role="group" aria-label="账号预设"><button v-for="option in [{ value: 'standard', label: '标准' }, { value: 'learner', label: '学习者' }, { value: 'custom', label: '自定义' }]" :key="option.value" type="button" :aria-pressed="preset === option.value" :class="{ active: preset === option.value }" @click="preset = option.value as typeof preset">{{ option.label }}</button></div><div class="legacy-sr-only" aria-hidden="true"><label v-for="option in ['standard', 'learner', 'custom']" :key="option"><input v-model="preset" type="radio" name="preset" :value="option" tabindex="-1">{{ option }}</label></div><p class="admin-preset-description">{{ preset === 'learner' ? '仅对话与沉浸式阅读，分配前禁用上传和工具。' : preset === 'custom' ? '创建普通账号后自行分配权限。' : '使用默认工作区行为。' }}</p></fieldset><p v-if="error" class="error" role="alert">{{ error }}</p><footer><button type="button" @click="showCreateDialog = false">取消</button><button class="primary" :disabled="busy">{{ busy ? '创建中…' : '创建' }}</button></footer></form></div>
    <div v-if="showImportDialog" class="admin-dialog-overlay" @click.self="showImportDialog = false"><form class="admin-dialog" role="dialog" aria-modal="true" aria-label="导入用户" @submit.prevent="importUsers"><header><h2>导入用户</h2><button type="button" aria-label="关闭" @click="showImportDialog = false">×</button></header><label>CSV 文件<input type="file" accept=".csv,text/csv" aria-label="选择 CSV 文件" :disabled="busy" @change="importFile = ($event.target as HTMLInputElement).files?.[0] || null; importResult = null"></label><p class="muted">CSV 列名：username,password,preset。只能导入普通用户账号。</p><p v-if="importResult" role="status">成功 {{ importResult.created_count }}，失败 {{ importResult.failed_count }}</p><ul v-if="importResult" class="admin-import-errors"><li v-for="item in importResult.results" :key="item.row"><span>第 {{ item.row }} 行 · {{ item.username }}</span><strong :class="{ ok: item.ok }">{{ item.ok ? '已创建' : item.error }}</strong></li></ul><p v-if="error" class="error" role="alert">{{ error }}</p><footer><button type="button" :disabled="busy" @click="showImportDialog = false">关闭</button><button class="primary" :disabled="busy || !importFile">导入</button></footer></form></div>
    <div v-if="deleteTarget" class="admin-dialog-overlay" @click.self="deleteTarget = null"><section class="admin-dialog admin-confirm-dialog" role="alertdialog" aria-modal="true" aria-label="删除用户"><header><h2>删除用户</h2><button aria-label="关闭" @click="deleteTarget = null">×</button></header><div class="admin-delete-user"><UserAvatar :username="deleteTarget.username" :user-id="deleteTarget.id" :avatar="deleteTarget.avatar" :role="deleteTarget.role" :size="32" /><strong>{{ deleteTarget.username }}</strong><p>{{ deleteTarget.role || '用户' }} · {{ deleteTarget.created_at ? new Date(deleteTarget.created_at).toLocaleDateString() : '—' }}</p></div><p>这将永久删除账号及其分配，无法撤销。</p><footer><button @click="deleteTarget = null">取消</button><button class="danger" :disabled="busy" @click="confirmRemove">删除用户</button></footer></section></div>
    <div v-if="batchDeleteConfirm" class="admin-dialog-overlay" @click.self="batchDeleteConfirm = false"><section class="admin-dialog admin-confirm-dialog" role="alertdialog" aria-modal="true" aria-label="删除多个用户"><header><h2>删除多个用户</h2><button aria-label="关闭" @click="batchDeleteConfirm = false">×</button></header><p>这将永久删除 {{ selected.length }} 个账号及其分配，无法撤销。</p><ul class="admin-delete-list"><li v-for="name in selected" :key="name">{{ name }}</li></ul><footer><button @click="batchDeleteConfirm = false">取消</button><button class="danger" :disabled="busy" @click="confirmRemoveSelected">删除用户</button></footer></section></div>
  </main>
  <main v-else class="admin-page"><div class="admin-content"><RouterLink to="/admin/users" class="admin-account-back">← 返回</RouterLink><h1 class="admin-accounts-title">管理员</h1><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" class="notice" role="status">{{ message }}</p><div class="record-list admin-account-list"><div v-for="row in rows" :key="row.id" class="record-row"><span>{{ row.username }}</span><span>{{ 'super_admin' in row ? (row.super_admin ? '超级管理员' : '管理员') : '' }}</span></div></div><form v-if="superAdmin" class="admin-create" @submit.prevent="create"><h2>创建管理员</h2><input v-model.trim="username" required autocomplete="off" placeholder="邮箱或用户名" /><input v-model="password" type="password" minlength="8" required autocomplete="new-password" placeholder="密码（至少 8 位）" /><button class="primary" :disabled="busy">{{ busy ? '创建中…' : '创建管理员' }}</button></form></div></main>
</template>
