<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, post } from '../api'

interface Relationship { id: string; learner_user_id: string; learner_username?: string; permissions: string[] }
interface Material { book_id: string; title?: string; assigned: boolean }
interface Report { learner: { username: string }; assigned_materials: Material[]; grant_summary: { model_count: number; knowledge_base_count: number; skill_count: number } }
interface Restriction { age_band: '6-8' | '9-12' | '13-15'; allow_upload: boolean; allowed_surfaces: string[]; extensions: string[] }
interface Extension { id: string; name?: string }

const props = defineProps<{ pending?: Record<string, unknown>; revision?: number }>()
const emit = defineEmits<{ change: [key: string, value: unknown]; loaded: [key: string, value: unknown] }>()
const relationships = ref<Relationship[]>([])
const selected = ref<Relationship | null>(null)
const report = ref<Report | null>(null)
const materials = ref<Material[]>([])
const selectedBooks = ref<string[]>([])
const restrictions = ref<Restriction | null>(null)
const extensions = ref<Extension[]>([])
const newPassword = ref('')
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const message = ref('')
const confirmAction = ref<'credentials' | 'revoke' | null>(null)
const permissionNames: Record<string, string> = { assign_materials: '管理材料', manage_restrictions: '管理限制', view_reports: '查看报告', reset_credentials: '重置凭据' }
const materialsKey = computed(() => `guardian:materials:${selected.value?.learner_user_id || ''}`)
const restrictionsKey = computed(() => `guardian:restrictions:${selected.value?.learner_user_id || ''}`)
function can(permission: string) { return selected.value?.permissions.includes(permission) ?? false }

async function load() {
  loading.value = true
  error.value = ''
  try {
    relationships.value = (await api<{ relationships: Relationship[] }>('/api/multi-user/me/guardianships')).relationships
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '监护关系加载失败' }
  finally { loading.value = false }
}
onMounted(() => { void load() })
watch(() => props.revision, () => {
  if (selected.value) void select(selected.value)
  else void load()
})
async function select(relationship: Relationship) {
  selected.value = relationship
  report.value = null
  materials.value = []
  selectedBooks.value = []
  restrictions.value = null
  extensions.value = []
  newPassword.value = ''
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    const id = encodeURIComponent(relationship.learner_user_id)
    const [nextReport, nextMaterials, nextRestrictions] = await Promise.all([
      can('view_reports') ? api<Report>(`/api/multi-user/learners/${id}/guardian-report`) : Promise.resolve(null),
      can('assign_materials') ? api<{ materials: Material[] }>(`/api/multi-user/learners/${id}/materials`) : Promise.resolve(null),
      can('manage_restrictions') ? api<{ restrictions: Restriction; available_extensions: Extension[] }>(`/api/multi-user/learners/${id}/restrictions`) : Promise.resolve(null),
    ])
    report.value = nextReport
    if (nextMaterials) {
      materials.value = nextMaterials.materials
      const live = nextMaterials.materials.filter(item => item.assigned).map(item => item.book_id)
      emit('loaded', materialsKey.value, live)
      selectedBooks.value = Array.isArray(props.pending?.[materialsKey.value]) ? [...props.pending[materialsKey.value] as string[]] : live
    }
    if (nextRestrictions) {
      extensions.value = nextRestrictions.available_extensions
      emit('loaded', restrictionsKey.value, nextRestrictions.restrictions)
      restrictions.value = props.pending?.[restrictionsKey.value]
        ? structuredClone(props.pending[restrictionsKey.value]) as Restriction
        : nextRestrictions.restrictions
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '学习者信息加载失败' }
  finally { busy.value = false }
}
function toggleBook(id: string) {
  selectedBooks.value = selectedBooks.value.includes(id)
    ? selectedBooks.value.filter(item => item !== id) : [...selectedBooks.value, id]
  emit('change', materialsKey.value, [...selectedBooks.value])
}
function updateRestrictions(patch: Partial<Restriction>) {
  if (!restrictions.value) return
  restrictions.value = { ...restrictions.value, ...patch }
  emit('change', restrictionsKey.value, { ...restrictions.value })
}
function toggleExtension(id: string) {
  if (!restrictions.value) return
  updateRestrictions({ extensions: restrictions.value.extensions.includes(id)
    ? restrictions.value.extensions.filter(item => item !== id)
    : [...restrictions.value.extensions, id] })
}
async function resetCredentials() {
  if (!selected.value || !can('reset_credentials') || newPassword.value.length < 8) return
  confirmAction.value = null
  busy.value = true
  error.value = ''
  try {
    await post(`/api/multi-user/learners/${encodeURIComponent(selected.value.learner_user_id)}/credentials/reset`, { new_password: newPassword.value })
    newPassword.value = ''
    message.value = '学习者凭据已重置'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '重置失败' }
  finally { busy.value = false }
}
async function revoke() {
  if (!selected.value) return
  confirmAction.value = null
  busy.value = true
  error.value = ''
  try {
    const id = selected.value.id
    await api(`/api/multi-user/me/guardianships/${encodeURIComponent(id)}`, { method: 'DELETE' })
    relationships.value = relationships.value.filter(item => item.id !== id)
    selected.value = null
    report.value = null
    message.value = '监护权限已撤销'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '撤销失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="guardian-settings">
    <header class="legacy-settings-page-header"><h1>监护管理</h1><p>查看已授权学习者及其获批的学习材料。</p></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="loading" class="muted">正在加载监护关系…</p>
    <p v-else-if="!relationships.length" class="muted">暂无有效的学习者监护关系。</p>
    <div v-else class="guardian-learner-grid">
      <button v-for="relationship in relationships" :key="relationship.id" type="button" :aria-pressed="selected?.id === relationship.id" @click="select(relationship)">
        <strong>{{ relationship.learner_username || relationship.learner_user_id }}</strong>
        <span>{{ relationship.permissions.map(item => permissionNames[item] || item).join(' · ') }}</span>
      </button>
    </div>
    <section v-if="selected" class="guardian-details">
      <header><h2>{{ report?.learner.username || selected.learner_username || selected.learner_user_id }}</h2><button type="button" :disabled="busy" @click="confirmAction = 'revoke'">撤销权限</button></header>
      <p v-if="busy" class="muted">正在加载学习者详情…</p>
      <div v-if="can('view_reports') && report" class="guardian-report-grid">
        <div><small>获批材料</small><strong>{{ report.assigned_materials.length }}</strong></div>
        <div><small>已启用的学习资源</small><strong>{{ report.grant_summary.model_count + report.grant_summary.knowledge_base_count + report.grant_summary.skill_count }}</strong></div>
      </div>
      <p v-else-if="!can('view_reports')" class="muted">你没有查看这位学习者报告的权限。</p>
      <section v-if="can('assign_materials')" class="guardian-card"><h3>获批材料</h3><p v-if="!materials.length" class="muted">暂无可分配的材料。</p><div v-else class="guardian-check-grid"><label v-for="material in materials" :key="material.book_id"><input type="checkbox" :checked="selectedBooks.includes(material.book_id)" :disabled="busy" @change="toggleBook(material.book_id)" />{{ material.title || material.book_id }}</label></div></section>
      <section v-if="can('manage_restrictions') && restrictions" class="guardian-card"><h3>学习限制</h3><div class="guardian-check-grid"><label>年龄段<select :value="restrictions.age_band" :disabled="busy" @change="updateRestrictions({ age_band: ($event.target as HTMLSelectElement).value as Restriction['age_band'] })"><option value="6-8">6-8</option><option value="9-12">9-12</option><option value="13-15">13-15</option></select></label><label><input type="checkbox" :checked="restrictions.allow_upload" :disabled="busy" @change="updateRestrictions({ allow_upload: ($event.target as HTMLInputElement).checked })" />允许学习者上传</label></div><div class="guardian-check-grid"><label v-for="extension in extensions" :key="extension.id"><input type="checkbox" :checked="restrictions.extensions.includes(extension.id)" :disabled="busy" @change="toggleExtension(extension.id)" />{{ extension.name || extension.id }}</label></div></section>
      <section v-if="can('reset_credentials')" class="guardian-card"><h3>重置凭据</h3><label>学习者新密码<input v-model="newPassword" type="password" minlength="8" autocomplete="new-password" :disabled="busy" /></label><button type="button" :disabled="busy || newPassword.length < 8" @click="confirmAction = 'credentials'">重置学习者凭据</button></section>
    </section>
    <div v-if="confirmAction" class="legacy-settings-modal-overlay" @click.self="confirmAction = null"><section class="legacy-settings-modal" role="dialog" aria-modal="true" :aria-label="confirmAction === 'credentials' ? '重置学习者凭据' : '撤销监护权限'"><header><h2>{{ confirmAction === 'credentials' ? '重置学习者凭据' : '撤销监护权限' }}</h2></header><div class="legacy-settings-modal-body"><p>{{ confirmAction === 'credentials' ? '这会修改学习者密码并撤销所有设备凭据。' : '这会立即移除你对该学习者账号的访问权限。' }}</p><div><button type="button" @click="confirmAction = null">取消</button><button type="button" class="legacy-settings-apply" :disabled="busy" @click="confirmAction === 'credentials' ? resetCredentials() : revoke()">确认</button></div></div></section></div>
  </main>
</template>

<style scoped>
.guardian-settings{max-width:768px;margin:auto;padding:0 0 40px}
.guardian-learner-grid,.guardian-report-grid,.guardian-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.guardian-learner-grid button{display:grid;gap:5px;padding:16px;border:1px solid var(--border);border-radius:9px;background:var(--card);text-align:left}
.guardian-learner-grid button[aria-pressed=true]{border-color:var(--primary);background:var(--muted)}
.guardian-learner-grid span,.guardian-settings small{color:var(--muted-foreground);font-size:12px}
.guardian-details{display:grid;gap:22px;margin-top:32px;padding-top:24px;border-top:1px solid var(--border)}
.guardian-details>header{display:flex;align-items:center;justify-content:space-between;gap:12px}
.guardian-details h2{margin:0;font-size:16px}
.guardian-details>header button,.guardian-card button{padding:7px 12px;border:1px solid #ef444466;border-radius:7px;background:transparent;color:#b42318}
.guardian-report-grid>div,.guardian-card{padding:16px;border:1px solid var(--border);border-radius:9px}
.guardian-report-grid>div{display:grid;gap:5px}.guardian-report-grid strong{font-size:20px}
.guardian-card h3{margin:0 0 14px;font-size:14px}.guardian-card>label{display:grid;gap:6px;font-size:13px}.guardian-card>label input{padding:8px;border:1px solid var(--border);border-radius:7px}
.guardian-check-grid label{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px}.guardian-check-grid select{margin-left:auto;padding:6px;border:1px solid var(--border);border-radius:6px}
.guardian-card .guardian-check-grid+.guardian-check-grid{margin-top:12px}.guardian-card button{margin-top:12px}
@media(max-width:640px){.guardian-learner-grid,.guardian-report-grid,.guardian-check-grid{grid-template-columns:1fr}}
</style>
