<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, post } from '../api'

interface Relationship { id: string; learner_user_id: string; learner_username?: string; permissions: string[] }
interface Material { book_id: string; title?: string; assigned: boolean }
const relationships = ref<Relationship[]>([])
const selected = ref<Relationship | null>(null)
const report = ref<unknown>(null)
const materials = ref<Material[]>([])
const selectedBooks = ref<Set<string>>(new Set())
const restrictions = ref<Record<string, any>>({})
const extensions = ref<{ id: string; name?: string }[]>([])
const newPassword = ref('')
const busy = ref(false)
const error = ref('')
const message = ref('')
function can(permission: string) { return selected.value?.permissions.includes(permission) ?? false }
async function load() {
  try { relationships.value = (await api<{ relationships: Relationship[] }>('/api/multi-user/me/guardianships')).relationships }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '监护关系加载失败' }
}
onMounted(load)
async function select(relationship: Relationship) {
  selected.value = relationship
  report.value = null
  materials.value = []
  restrictions.value = {}
  newPassword.value = ''
  busy.value = true
  try {
    const [nextReport, nextMaterials, nextRestrictions] = await Promise.all([
      can('view_reports') ? api(`/api/multi-user/learners/${encodeURIComponent(relationship.learner_user_id)}/guardian-report`) : Promise.resolve(null),
      can('assign_materials') ? api<{ materials: Material[] }>(`/api/multi-user/learners/${encodeURIComponent(relationship.learner_user_id)}/materials`) : Promise.resolve(null),
      can('manage_restrictions') ? api<{ restrictions: Record<string, any>; available_extensions: typeof extensions.value }>(`/api/multi-user/learners/${encodeURIComponent(relationship.learner_user_id)}/restrictions`) : Promise.resolve(null),
    ])
    report.value = nextReport
    if (nextMaterials) { materials.value = nextMaterials.materials; selectedBooks.value = new Set(nextMaterials.materials.filter(item => item.assigned).map(item => item.book_id)) }
    if (nextRestrictions) { restrictions.value = nextRestrictions.restrictions; extensions.value = nextRestrictions.available_extensions }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '学习者信息加载失败' }
  finally { busy.value = false }
}
function toggleBook(id: string) { if (selectedBooks.value.has(id)) selectedBooks.value.delete(id); else selectedBooks.value.add(id) }
async function saveMaterials() {
  if (!selected.value) return
  busy.value = true
  try { await api(`/api/multi-user/learners/${encodeURIComponent(selected.value.learner_user_id)}/materials`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_ids: [...selectedBooks.value] }) }); message.value = '阅读材料已更新' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存材料失败' }
  finally { busy.value = false }
}
async function saveRestrictions() {
  if (!selected.value) return
  busy.value = true
  try { restrictions.value = (await api<{ restrictions: Record<string, any> }>(`/api/multi-user/learners/${encodeURIComponent(selected.value.learner_user_id)}/restrictions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(restrictions.value) })).restrictions; message.value = '学习限制已更新' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存限制失败' }
  finally { busy.value = false }
}
async function resetCredentials() {
  if (!selected.value || newPassword.value.length < 8 || !confirm('重置学习者密码并撤销其设备凭据？')) return
  busy.value = true
  try { await post(`/api/multi-user/learners/${encodeURIComponent(selected.value.learner_user_id)}/credentials/reset`, { new_password: newPassword.value }); newPassword.value = ''; message.value = '学习者凭据已重置' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '重置失败' }
  finally { busy.value = false }
}
async function revoke() {
  if (!selected.value || !confirm('撤销这条监护关系？')) return
  busy.value = true
  try { await api(`/api/multi-user/me/guardianships/${encodeURIComponent(selected.value.id)}`, { method: 'DELETE' }); relationships.value = relationships.value.filter(item => item.id !== selected.value!.id); selected.value = null; message.value = '监护权限已撤销' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '撤销失败' }
  finally { busy.value = false }
}
</script>

<template>
  <section><h2>监护管理</h2><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" class="notice" role="status">{{ message }}</p><aside class="settings-nav"><button v-for="relationship in relationships" :key="relationship.id" :class="{ active: selected?.id === relationship.id }" @click="select(relationship)">{{ relationship.learner_username || relationship.learner_user_id }}</button></aside><template v-if="selected"><section v-if="can('view_reports')"><h3>学习报告</h3><pre>{{ JSON.stringify(report, null, 2) }}</pre></section><section v-if="can('assign_materials')"><h3>阅读材料</h3><label v-for="material in materials" :key="material.book_id" class="settings-check"><input type="checkbox" :checked="selectedBooks.has(material.book_id)" @change="toggleBook(material.book_id)">{{ material.title || material.book_id }}</label><button :disabled="busy" @click="saveMaterials">保存材料</button></section><section v-if="can('manage_restrictions')"><h3>学习限制</h3><div class="settings-form"><label v-for="extension in extensions" :key="extension.id" class="settings-check"><input type="checkbox" :checked="Boolean(restrictions[extension.id]?.enabled ?? restrictions[extension.id])" @change="restrictions[extension.id] = { ...(typeof restrictions[extension.id] === 'object' ? restrictions[extension.id] : {}), enabled: ($event.target as HTMLInputElement).checked }">{{ extension.name || extension.id }}</label></div><button :disabled="busy" @click="saveRestrictions">保存限制</button></section><section v-if="can('reset_credentials')"><h3>重置凭据</h3><label>新密码<input v-model="newPassword" type="password" minlength="8" autocomplete="new-password" /></label><button :disabled="busy || newPassword.length < 8" @click="resetCredentials">重置学习者密码</button></section><button @click="revoke">撤销监护关系</button></template></section>
</template>
