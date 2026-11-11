<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, post } from '../api'

type User = { id: string; username: string; role?: string; preset?: string }
type Relationship = { id: string; guardian_user_id: string; guardian_username: string; learner_user_id: string; permissions: string[] }
type Report = { assigned_materials: unknown[]; grant_summary: { model_count: number; knowledge_base_count: number; skill_count: number } }
const props = defineProps<{ learnerId: string; learnerUsername: string; users: User[] }>()
const permissions = [
  { id: 'assign_materials', label: '管理阅读材料' },
  { id: 'manage_restrictions', label: '管理学习限制' },
  { id: 'view_reports', label: '查看学习报告' },
  { id: 'reset_credentials', label: '重置凭据' },
] as const
const relationships = ref<Relationship[]>([])
const report = ref<Report | null>(null)
const guardianId = ref('')
const selectedPermissions = ref<string[]>(permissions.map(item => item.id))
const password = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const confirm = ref<{ kind: 'revoke'; relationship: Relationship } | { kind: 'reset' } | null>(null)
const candidates = computed(() => props.users.filter(user =>
  user.role !== 'admin' && user.id !== props.learnerId && user.preset !== 'learner'
  && !relationships.value.some(item => item.guardian_user_id === user.id),
))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [listed, summary] = await Promise.all([
      api<{ relationships: Relationship[] }>('/api/multi-user/guardians'),
      api<Report>(`/api/multi-user/learners/${encodeURIComponent(props.learnerId)}/guardian-report`),
    ])
    relationships.value = listed.relationships.filter(item => item.learner_user_id === props.learnerId)
    report.value = summary
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '监护关系加载失败' }
  finally { loading.value = false }
}
onMounted(() => { void load() })
watch(() => props.learnerId, () => { void load() })
function togglePermission(id: string) {
  selectedPermissions.value = selectedPermissions.value.includes(id)
    ? selectedPermissions.value.filter(item => item !== id)
    : [...selectedPermissions.value, id]
}
async function authorize() {
  if (!guardianId.value || !selectedPermissions.value.length) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await post('/api/multi-user/guardians', {
      guardian_user_id: guardianId.value, learner_user_id: props.learnerId,
      permissions: selectedPermissions.value,
    })
    guardianId.value = ''
    message.value = '已授权监护关系'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '授权失败' }
  finally { busy.value = false }
}
async function requestRevoke(relationship: Relationship) {
  confirm.value = { kind: 'revoke', relationship }
}
async function revoke(relationship: Relationship) {
  busy.value = true
  error.value = ''
  try {
    await api(`/api/multi-user/guardians/${encodeURIComponent(relationship.id)}`, { method: 'DELETE' })
    message.value = '已撤销监护权限'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '撤销失败' }
  finally { busy.value = false }
}
function requestReset() {
  if (password.value.length < 8) return
  confirm.value = { kind: 'reset' }
}
async function resetCredentials() {
  busy.value = true
  error.value = ''
  try {
    await post(`/api/multi-user/learners/${encodeURIComponent(props.learnerId)}/credentials/reset`, { new_password: password.value })
    password.value = ''
    message.value = '已重置学习者凭据'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '重置失败' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="admin-assignment admin-guardian-editor">
    <header><div><h3>监护关系</h3><p>授权普通账号监护 {{ learnerUsername }}。</p></div></header>
    <p v-if="loading">加载中…</p>
    <div v-for="relationship in relationships" :key="relationship.id" class="admin-guardian-row">
      <span>{{ relationship.guardian_username }} · {{ relationship.permissions.map(id => permissions.find(item => item.id === id)?.label || id).join('、') }}</span>
      <button type="button" :disabled="busy" aria-label="撤销访问" @click="requestRevoke(relationship)">×</button>
    </div>
    <p v-if="!loading && !relationships.length" class="admin-empty-card">暂无活跃监护关系。</p>
    <div class="admin-guardian-form">
      <select v-model="guardianId" aria-label="选择监护人" :disabled="busy || !candidates.length"><option value="">选择监护人</option><option v-for="user in candidates" :key="user.id" :value="user.id">{{ user.username }}</option></select>
      <div class="admin-profile-fields"><label v-for="permission in permissions" :key="permission.id"><input type="checkbox" :checked="selectedPermissions.includes(permission.id)" :disabled="busy" @change="togglePermission(permission.id)" /> {{ permission.label }}</label></div>
      <button type="button" class="primary" :disabled="busy || !guardianId || !selectedPermissions.length" @click="authorize">授权监护人</button>
    </div>
    <p v-if="report">{{ report.assigned_materials.length }} 份已分配材料 · {{ report.grant_summary.model_count + report.grant_summary.knowledge_base_count + report.grant_summary.skill_count }} 项已启用资源</p>
    <div class="admin-guardian-form admin-credential-card">
      <label>学习者新密码 <input v-model="password" type="password" minlength="8" autocomplete="new-password" :disabled="busy" /></label>
      <button type="button" class="admin-danger-outline" :disabled="busy || password.length < 8" @click="requestReset">重置学习者凭据</button>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <div v-if="confirm" class="admin-dialog-overlay" @click.self="confirm = null"><section class="admin-dialog admin-confirm-dialog" role="alertdialog" aria-modal="true"><header><h2>{{ confirm.kind === 'reset' ? '重置学习者凭据' : '撤销监护访问' }}</h2><button aria-label="关闭" @click="confirm = null">×</button></header><p>{{ confirm.kind === 'reset' ? '这会更改学习者密码，并撤销所有学习者设备凭据。' : '这将立即移除对该学习者账号的访问。' }}</p><footer><button @click="confirm = null">取消</button><button class="danger" :disabled="busy" @click="confirm.kind === 'reset' ? resetCredentials() : revoke(confirm.kind === 'revoke' ? confirm.relationship : ({} as Relationship))">{{ confirm.kind === 'reset' ? '重置凭据' : '撤销访问' }}</button></footer></section></div>
  </section>
</template>
