<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'

type Item = Record<string, unknown>
type Policy = { age_band: '6-8' | '9-12' | '13-15'; locked_persona: 'teacher'; allowed_capabilities: string[]; default_capability: string; allowed_surfaces: string[]; reading: { allow_upload: boolean; material_ids: string[]; extensions: string[] } }
type Grant = { version: number; user_id: string; models: { llm: Item[] }; knowledge_bases: Item[]; skills: Item[]; partners: Item[]; enabled_tools: string[] | null; mcp_tools: string[] | null; cli_apps?: string[] | null; exec_enabled: boolean | null; learning_policy: Policy | null }
type Resources = {
  models: { llm: { profile_id: string; name: string; models?: { model_id: string; name: string }[] }[] }
  knowledge_bases: { resource_id: string; name: string }[]
  skills: { name: string; description?: string }[]
  partners: { partner_id: string; name: string }[]
  reading_materials: { material_id: string; title: string; filename: string }[]
  reading_extensions: { id: string; name: string; version?: string }[]
  tools: { name: string; description?: string }[]
  mcp_tools: { name: string; provider_id?: string }[]
}
const props = defineProps<{ userId: string; learner: boolean }>()
const grant = ref<Grant | null>(null)
const resources = ref<Resources | null>(null)
const saved = ref('')
const loading = ref(false)
const saving = ref(false)
const feedback = ref('')
const dirty = computed(() => Boolean(saved.value) && saved.value !== JSON.stringify(grant.value))
const modelCount = computed(() => grant.value?.models.llm.reduce((total, item) => total + (Array.isArray(item.model_ids) ? (item.model_ids as string[]).length : 1), 0) || 0)
const toolsSummary = computed(() => !grant.value || grant.value.enabled_tools === null ? '全部工具' : `${grant.value.enabled_tools.length} 个工具`)
const mcpSummary = computed(() => !grant.value || grant.value.mcp_tools === null ? '无 MCP' : `${grant.value.mcp_tools.length} 个 MCP`)

async function load() {
  loading.value = true
  feedback.value = ''
  try {
    const [catalog, response] = await Promise.all([
      api<Resources>('/api/multi-user/admin/resources'),
      api<{ grant: Grant }>(`/api/multi-user/users/${encodeURIComponent(props.userId)}/grants`),
    ])
    resources.value = catalog
    grant.value = response.grant
    saved.value = JSON.stringify(response.grant)
  } catch (cause) { feedback.value = cause instanceof Error ? cause.message : '资源授权加载失败' }
  finally { loading.value = false }
}
onMounted(load)
watch(() => props.userId, load)

function selected(key: 'knowledge_bases' | 'skills' | 'partners', field: string, id: string) {
  return Boolean(grant.value?.[key].some(item => String(item[field] || item.id || '') === id))
}
function toggleResource(key: 'knowledge_bases' | 'skills' | 'partners', field: string, id: string, value: Item) {
  if (!grant.value) return
  const entries = grant.value[key]
  grant.value[key] = selected(key, field, id) ? entries.filter(item => String(item[field] || item.id || '') !== id) : [...entries, value]
}
function modelSelected(profileId: string, modelId: string) {
  return Boolean(grant.value?.models.llm.some(item => item.profile_id === profileId && Array.isArray(item.model_ids) && (item.model_ids as string[]).includes(modelId)))
}
function toggleModel(profileId: string, modelId: string) {
  if (!grant.value) return
  const entries: Array<Item & { profile_id?: string; model_ids: string[] }> = grant.value.models.llm.map(item => ({ ...item, model_ids: Array.isArray(item.model_ids) ? [...item.model_ids as string[]] : [] }))
  const index = entries.findIndex(item => item.profile_id === profileId)
  const entry: Item & { profile_id?: string; model_ids: string[] } = index >= 0 ? entries[index] as Item & { model_ids: string[] } : { profile_id: profileId, model_ids: [], source: 'admin' }
  if (index < 0) entries.push(entry)
  const ids = entry.model_ids as string[]
  entry.model_ids = ids.includes(modelId) ? ids.filter(id => id !== modelId) : [...ids, modelId]
  grant.value.models.llm = entries.filter(item => (item.model_ids as string[]).length > 0)
}
function toggleList(key: 'enabled_tools' | 'mcp_tools', name: string) {
  if (!grant.value || grant.value[key] === null) return
  const list = grant.value[key] as string[]
  ;(grant.value[key] as string[] | null) = list.includes(name) ? list.filter(item => item !== name) : [...list, name]
}
function switchToolMode(key: 'enabled_tools' | 'mcp_tools', custom: boolean) {
  if (!grant.value) return
  if (custom) grant.value[key] = grant.value[key] ?? []
  else grant.value[key] = null
}
function togglePolicy() {
  if (!grant.value || props.learner) return
  grant.value.learning_policy = grant.value.learning_policy ? null : {
    age_band: '9-12', locked_persona: 'teacher',
    allowed_capabilities: ['chat', 'immersive_reading'], default_capability: 'immersive_reading',
    allowed_surfaces: ['chat', 'reading'], reading: { allow_upload: false, material_ids: [], extensions: [] },
  }
}
function updatePolicy(changes: Partial<Policy>) { if (grant.value?.learning_policy) grant.value.learning_policy = { ...grant.value.learning_policy, ...changes } }
function toggleReading(key: 'material_ids' | 'extensions', id: string) {
  const reading = grant.value?.learning_policy?.reading
  if (!reading) return
  reading[key] = reading[key].includes(id) ? reading[key].filter(item => item !== id) : [...reading[key], id]
}
async function save() {
  if (!grant.value) return
  saving.value = true
  feedback.value = ''
  try {
    const response = await api<{ grant: Grant }>(`/api/multi-user/users/${encodeURIComponent(props.userId)}/grants`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant: grant.value }),
    })
    grant.value = response.grant
    saved.value = JSON.stringify(response.grant)
    feedback.value = '刚刚保存'
  } catch (cause) { feedback.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { saving.value = false }
}
</script>

<template>
  <section class="admin-assignment admin-grant-legacy">
    <div class="admin-grant-shell">
      <header class="admin-grant-head">
        <div><h2>功能分配</h2><p>管理员资源保留在服务端关联，用户只会获得已允许的访问权限。</p></div>
        <div class="admin-grant-summary"><span>{{ modelCount }} 个模型</span><span>{{ grant?.knowledge_bases.length || 0 }} 个知识库</span><span>{{ grant?.skills.length || 0 }} 个技能</span><span>{{ grant?.partners.length || 0 }} 个伙伴</span><span>{{ toolsSummary }}</span><span>{{ mcpSummary }}</span></div>
      </header>
      <p v-if="loading" class="muted">正在加载功能分配…</p>
      <template v-else-if="grant && resources">
        <div class="admin-grant-body">
          <section class="admin-policy-card">
            <label class="admin-policy-toggle"><input type="checkbox" :checked="Boolean(grant.learning_policy)" :disabled="learner || saving" @change="togglePolicy"><span><strong>启用学习策略</strong><small>教师角色；仅开放聊天和沉浸式阅读</small></span></label>
            <div v-if="grant.learning_policy" class="admin-policy-detail">
              <label>年龄段<select v-model="grant.learning_policy.age_band" :disabled="saving"><option value="6-8">6-8</option><option value="9-12">9-12</option><option value="13-15">13-15</option></select></label>
              <fieldset><legend>可用能力</legend><label v-for="capability in ['chat', 'deep_research', 'immersive_reading']" :key="capability"><input type="checkbox" :checked="grant.learning_policy.allowed_capabilities.includes(capability)" @change="updatePolicy({ allowed_capabilities: grant.learning_policy!.allowed_capabilities.includes(capability) ? grant.learning_policy!.allowed_capabilities.filter(item => item !== capability) : [...grant.learning_policy!.allowed_capabilities, capability] })">{{ capability }}</label></fieldset>
              <fieldset><legend>开放界面</legend><label v-for="surface in ['chat', 'reading', 'notebook']" :key="surface"><input type="checkbox" :checked="grant.learning_policy.allowed_surfaces.includes(surface)" @change="updatePolicy({ allowed_surfaces: grant.learning_policy!.allowed_surfaces.includes(surface) ? grant.learning_policy!.allowed_surfaces.filter(item => item !== surface) : [...grant.learning_policy!.allowed_surfaces, surface] })">{{ surface }}</label></fieldset>
              <fieldset><legend>阅读材料</legend><label v-for="material in resources.reading_materials" :key="material.material_id" class="admin-check-card"><input type="checkbox" :checked="grant.learning_policy.reading.material_ids.includes(material.material_id)" @change="toggleReading('material_ids', material.material_id)"><span><strong>{{ material.title || material.filename }}</strong><small>{{ material.filename }}</small></span></label><p v-if="!resources.reading_materials.length" class="muted">可在阅读中上传书籍后分配材料。</p></fieldset>
              <fieldset><legend>阅读扩展</legend><label v-for="extension in resources.reading_extensions" :key="extension.id" class="admin-check-card"><input type="checkbox" :checked="grant.learning_policy.reading.extensions.includes(extension.id)" @change="toggleReading('extensions', extension.id)"><span><strong>{{ extension.name }}</strong><small>{{ extension.id }} · {{ extension.version || '—' }}</small></span></label></fieldset>
              <label class="admin-upload-check"><input type="checkbox" v-model="grant.learning_policy.reading.allow_upload" :disabled="saving">允许学习者上传</label>
            </div>
          </section>

          <section><h3>模型</h3><div v-for="profile in resources.models.llm" :key="profile.profile_id" class="admin-resource-card"><strong>{{ profile.name }}</strong><label v-for="model in profile.models || []" :key="model.model_id"><input type="checkbox" :checked="modelSelected(profile.profile_id, model.model_id)" :disabled="saving" @change="toggleModel(profile.profile_id, model.model_id)">{{ model.name }}</label></div></section>
          <section><h3>知识库</h3><label v-for="kb in resources.knowledge_bases" :key="kb.resource_id" class="admin-check-card"><input type="checkbox" :checked="selected('knowledge_bases', 'resource_id', kb.resource_id)" :disabled="saving" @change="toggleResource('knowledge_bases', 'resource_id', kb.resource_id, { resource_id: kb.resource_id, name: kb.name, access: 'read', source: 'admin' })"><span><strong>{{ kb.name }}</strong></span></label></section>
          <section><h3>技能</h3><label v-for="skill in resources.skills" :key="skill.name" class="admin-check-card"><input type="checkbox" :checked="selected('skills', 'skill_id', skill.name)" :disabled="saving" @change="toggleResource('skills', 'skill_id', skill.name, { skill_id: skill.name, access: 'use', source: 'admin' })"><span><strong>{{ skill.name }}</strong><small v-if="skill.description">{{ skill.description }}</small></span></label></section>
          <section><h3>伙伴</h3><p v-if="!resources.partners.length" class="muted">还没有可分配伙伴。</p><label v-for="partner in resources.partners" :key="partner.partner_id" class="admin-check-card"><input type="checkbox" :checked="selected('partners', 'partner_id', partner.partner_id)" :disabled="saving" @change="toggleResource('partners', 'partner_id', partner.partner_id, { partner_id: partner.partner_id, name: partner.name, source: 'admin' })"><span><strong>{{ partner.name }}</strong></span></label></section>
          <section class="admin-system-tools"><h3>系统工具</h3><div class="admin-segmented"><button type="button" :class="{ active: grant.enabled_tools === null }" @click="switchToolMode('enabled_tools', false)">默认 · 全部</button><button type="button" :class="{ active: grant.enabled_tools !== null }" @click="switchToolMode('enabled_tools', true)">自定义</button></div><div v-if="grant.enabled_tools !== null" class="admin-check-grid"><label v-for="tool in resources.tools" :key="tool.name" class="admin-check-card"><input type="checkbox" :checked="grant.enabled_tools.includes(tool.name)" :disabled="saving" @change="toggleList('enabled_tools', tool.name)"><span><strong>{{ tool.name }}</strong><small v-if="tool.description">{{ tool.description }}</small></span></label></div></section>
          <section class="admin-mcp-tools"><h3>MCP 工具</h3><div class="admin-segmented"><button type="button" :class="{ active: grant.mcp_tools === null }" @click="switchToolMode('mcp_tools', false)">默认 · 无</button><button type="button" :class="{ active: grant.mcp_tools !== null }" @click="switchToolMode('mcp_tools', true)">自定义</button></div><p class="muted admin-mcp-note">MCP 工具代理服务端能力，默认拒绝；切换到自定义后再分配。</p><div v-if="grant.mcp_tools !== null" class="admin-check-grid"><label v-for="tool in resources.mcp_tools" :key="tool.name" class="admin-check-card"><input type="checkbox" :checked="grant.mcp_tools.includes(tool.name)" :disabled="saving" @change="toggleList('mcp_tools', tool.name)"><span><strong>{{ tool.name }}</strong><small v-if="tool.provider_id">{{ tool.provider_id }}</small></span></label></div></section>
        </div>
        <footer class="admin-grant-footer"><p :class="feedback === '刚刚保存' ? 'ok' : ''">{{ feedback || (dirty ? '有未保存的更改' : '就绪') }}</p><button class="primary" :disabled="saving || !dirty" @click="save">{{ saving ? '正在保存…' : '保存' }}</button></footer>
      </template>
      <p v-else role="alert">{{ feedback }}</p>
    </div>
  </section>
</template>
