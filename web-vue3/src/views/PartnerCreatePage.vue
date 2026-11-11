<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, post } from '../api'
import PartnerAvatar from '../components/PartnerAvatar.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import SoulPicker from '../components/SoulPicker.vue'
import PartnerModelPicker from '../components/PartnerModelPicker.vue'
import PartnerModelSelect from '../components/PartnerModelSelect.vue'
import PartnerToolPicker from '../components/PartnerToolPicker.vue'
import PartnerWorkspacePicker from '../components/PartnerWorkspacePicker.vue'
import PartnerAssetPicker from '../components/PartnerAssetPicker.vue'

interface Partner { partner_id: string; name: string; description?: string; emoji?: string; color?: string; avatar?: string }
interface Group { group_id: string }
interface Mode { name: string; label: string; description: string }
interface SoulTemplate { id: string; name: string; content: string }
interface LLMOption { profile_id: string; model_id: string; profile_name: string; model_name: string; model?: string; provider?: string; provider_label?: string; context_window?: number }
interface Tool { name: string; description?: string }
interface Workspace { workspace_id: string; kind: string; display_name: string; archived: boolean; status: string }
const props = defineProps<{ kind: 'partner' | 'group' }>()
const router = useRouter()
const step = ref(0)
const steps = ['身份', '灵魂', '心智', '资料库', '审阅']
const form = reactive({
  name: '', description: '', emoji: '', color: '', avatar: '', language: '', start: true,
  soulSource: 'default' as 'default' | 'library' | 'persona' | 'custom', soulId: '', soul: '',
  profileId: '', modelId: '', backupProfileId: '', backupModelId: '', workspaceId: '',
  enabledTools: [] as string[], builtinTools: [] as string[], mcpTools: [] as string[],
  assets: { knowledge_bases: [] as string[], skills: [] as string[], notebooks: [] as string[] },
  member_ids: [] as string[], discussion_mode: 'panel_parallel',
})
const partners = ref<Partner[]>([])
const modes = ref<Mode[]>([])
const soulLibrary = ref<SoulTemplate[]>([])
const personas = ref<{ name: string; description?: string; content?: string }[]>([])
const llmOptions = ref<LLMOption[]>([])
const activeLLMDefault = ref<{ profile_id: string; model_id: string } | null>(null)
const tools = ref<Tool[]>([])
const builtinTools = ref<Tool[]>([])
const mcpTools = ref<Tool[]>([])
const workspaces = ref<Workspace[]>([])
const knowledgeBases = ref<{ name: string }[]>([])
const skills = ref<{ name: string; description?: string }[]>([])
const notebooks = ref<{ id: string; name: string; description?: string }[]>([])
const loading = ref(true)
const toolsTouched = ref(false)
const error = ref('')
const busy = ref(false)
const partnerMenuOpen = ref(false)
const palette = ['#b0501e', '#8c6a2f', '#4f7a5b', '#3d6b8a', '#6d5a8c', '#8a4f5f', '#a8763e', '#5b8a8a']
const emojis = ['🦊', '🐳', '🦉', '🐱', '🐶', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦄', '🤖', '👾', '🌱', '🌸', '🍀', '🌙', '✨', '🔥', '📚', '🎨', '🎧', '🧭']
const hasImage = computed(() => Boolean(form.avatar))
const stepTitle = computed(() => ['这个伙伴是谁？', '赋予它灵魂', '塑造它的心智', '交给它一些知识', `准备好见到 ${form.name.trim() || '你的伙伴'} 了吗？`][step.value])
const stepSubtitle = computed(() => ['先取个名字、选个形象——其余以后都能改。', '它是谁。可以从模板开始、克隆一个聊天 Persona，或亲手撰写。', '它思考用的模型，以及允许使用的工具。', '选择共享工作区，或将资料复制到 Partner 的私有工作区。', '就快好了——创建前最后确认一下。'][step.value])
const selectedPartners = computed(() => partners.value.filter(partner => form.member_ids.includes(partner.partner_id)))
const workspaceName = computed(() => workspaces.value.find(item => item.workspace_id === form.workspaceId)?.display_name || '伙伴私有工作区')
const soulSummary = computed(() => form.soulSource === 'default' ? '默认灵魂' : form.soulSource === 'custom' ? '自定义灵魂' : `${form.soulSource === 'library' ? '灵魂库' : 'Persona'} · ${form.soulId}`)
const selectedModel = computed(() => llmOptions.value.find(item => item.profile_id === form.profileId && item.model_id === form.modelId))
const backupModel = computed(() => llmOptions.value.find(item => item.profile_id === form.backupProfileId && item.model_id === form.backupModelId))
function modeLabel(name: string) { return ({ panel_parallel: '并行回答', sequential: '依次补充', debate: '交叉辩论' } as Record<string, string>)[name] || name }
function modeHint(mode: Mode) { return mode.name === 'panel_parallel' ? '所有人同时独立回答同一个问题。' : mode.name === 'sequential' ? '每位伙伴都能看到前面说过的内容，在此之上补充。' : mode.name === 'debate' ? '先各自表明立场，再针对分歧互相回应。' : mode.description }
function modeCost(mode: Mode) { return mode.name === 'panel_parallel' ? '最快' : mode.name === 'sequential' ? '较慢 · 需要依次等待' : mode.name === 'debate' ? '两轮 · 等待约翻倍' : '' }
function modelValue(profileId: string, modelId: string) { return profileId && modelId ? `${profileId}:${modelId}` : '' }
function selectModel(value: string, backup = false) {
  const [profileId, modelId] = value.split(':')
  if (backup) { form.backupProfileId = profileId || ''; form.backupModelId = modelId || '' }
  else { form.profileId = profileId || ''; form.modelId = modelId || '' }
}
function selectSoul() {
  const source = form.soulSource === 'library' ? soulLibrary.value.find(item => item.id === form.soulId) : personas.value.find(item => item.name === form.soulId)
  if (source) form.soul = source.content || ''
}
function toggle(list: string[], value: string, touch = true) {
  const index = list.indexOf(value)
  if (index >= 0) list.splice(index, 1)
  else list.push(value)
  if (touch) toolsTouched.value = true
}
function toggleAsset(key: keyof typeof form.assets, value: string) { toggle(form.assets[key], value, false) }
async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 10 * 1024 * 1024) { error.value = '头像不能超过 10 MB'; return }
  try { form.avatar = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('头像读取失败')); reader.readAsDataURL(file) }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '头像读取失败' }
}
onMounted(async () => {
  if (props.kind === 'group') {
    form.emoji = '👥'; form.color = palette[0]
    const [roster, discussionModes] = await Promise.all([api<Partner[]>('/api/partners').catch(() => []), api<Mode[]>('/api/partner-groups/discussion-modes').catch(() => [])])
    partners.value = roster
    modes.value = discussionModes
    loading.value = false
    return
  }
  const [souls, models, toolOptions, workspaceResult, kbResult, skillResult, notebookResult] = await Promise.all([
    api<{ library: SoulTemplate[]; personas: typeof personas.value }>('/api/partners/soul-sources').catch(() => ({ library: [], personas: [] })),
    api<{ active: { profile_id: string; model_id: string } | null; options: LLMOption[] }>('/api/settings/llm-options').catch(() => ({ active: null, options: [] })),
    api<{ tools: Tool[]; builtin_tools: Tool[]; mcp_tools: Tool[] }>('/api/partners/tool-options').catch(() => ({ tools: [], builtin_tools: [], mcp_tools: [] })),
    api<{ workspaces: Workspace[] }>('/api/settings/workspace/registrations').catch(() => ({ workspaces: [] })),
    api<{ name: string }[]>('/api/knowledge-bases/list').catch(() => []),
    api<{ skills: { name: string; description?: string }[] }>('/api/skills/list').catch(() => ({ skills: [] })),
    api<{ notebooks: { id: string; name: string; description?: string }[] }>('/api/notebooks').catch(() => ({ notebooks: [] })),
  ])
  soulLibrary.value = souls.library
  personas.value = souls.personas
  llmOptions.value = models.options
  activeLLMDefault.value = models.active
  tools.value = toolOptions.tools
  builtinTools.value = toolOptions.builtin_tools
  mcpTools.value = toolOptions.mcp_tools
  form.enabledTools = toolOptions.tools.map(item => item.name)
  form.builtinTools = toolOptions.builtin_tools.map(item => item.name)
  workspaces.value = workspaceResult.workspaces.filter(item => item.kind !== 'system' && !item.archived && item.status === 'ready')
  knowledgeBases.value = kbResult
  skills.value = skillResult.skills
  notebooks.value = notebookResult.notebooks
  form.assets.skills = skillResult.skills.map(item => item.name)
  if (souls.library[0]) { form.soulSource = 'library'; form.soulId = souls.library[0].id; form.soul = souls.library[0].content }
  loading.value = false
})
async function create() {
  busy.value = true
  error.value = ''
  try {
    if (props.kind === 'partner') {
      const result = await post<Partner>('/api/partners', {
        name: form.name.trim(), description: form.description.trim() || undefined,
        soul: form.soulSource === 'default' ? { source: 'default' } : { source: form.soulSource, id: form.soulId || undefined, content: form.soul },
        llm_selection: form.profileId && form.modelId ? { profile_id: form.profileId, model_id: form.modelId } : null,
        backup_llm_selection: form.backupProfileId && form.backupModelId ? { profile_id: form.backupProfileId, model_id: form.backupModelId } : null,
        language: form.language || undefined, emoji: form.emoji || undefined, color: form.color || undefined, avatar: form.avatar || undefined,
        enabled_tools: toolsTouched.value ? form.enabledTools : form.enabledTools.length === tools.value.length ? null : form.enabledTools,
        builtin_tools: toolsTouched.value ? form.builtinTools : form.builtinTools.length === builtinTools.value.length ? null : form.builtinTools,
        mcp_tools: form.mcpTools, workspace_id: form.workspaceId, assets: form.workspaceId ? undefined : form.assets, start: true,
      })
      await router.push(`/partners/${encodeURIComponent(result.partner_id)}`)
    } else {
      if (form.member_ids.length < 2) throw new Error('至少选择两位伙伴')
      const result = await post<Group>('/api/partner-groups', { name: form.name.trim(), description: form.description.trim(), emoji: form.emoji || '👥', color: form.color, member_ids: form.member_ids, discussion_mode: form.discussion_mode, shared_memory: 'whiteboard' })
      await router.push(`/partners/groups/${encodeURIComponent(result.group_id)}`)
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="feature-page partner-form-page"><header v-if="kind === 'partner'" class="partner-create-page-bar"><span class="dt-crumb is-feature"><LegacyIcon name="partners" :size="15" />伙伴</span></header><div v-if="kind === 'partner'" class="partner-wizard-top"><RouterLink to="/partners" class="text-button">← 伙伴</RouterLink><ol class="partner-wizard-steps"><li v-for="(label, index) in steps" :key="label" :class="{ active: step === index, done: step > index }"><span v-if="index" class="partner-step-line"></span><button type="button" :disabled="index > step" :aria-label="label" @click="step = index"><span class="partner-step-number">{{ step > index ? '✓' : index + 1 }}</span><span class="partner-step-label">{{ label }}</span></button></li></ol><span class="partner-wizard-top-spacer" /></div><p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="kind === 'partner'"><form class="settings-form partner-wizard-form" @submit.prevent="step < steps.length - 1 ? step++ : create()"><div class="partner-wizard-body"><header class="partner-wizard-heading"><h1>{{ stepTitle }}</h1><p>{{ stepSubtitle }}</p></header>
      <template v-if="step === 0"><div class="partner-identity-fields"><label>名称<input v-model="form.name" required maxlength="80" placeholder="例如 Ada" autofocus @keydown.enter.prevent="form.name.trim() && step++" /></label><label>简介<input v-model="form.description" maxlength="500" placeholder="这个伙伴是做什么的？" /></label><section class="partner-face-editor"><h2>形象</h2><PartnerAvatar :name="form.name" :emoji="form.emoji" :color="form.color" :image="form.avatar" :size="88" /><div class="partner-emoji-grid"><button v-for="emoji in emojis" :key="emoji" type="button" class="partner-emoji-choice" :aria-pressed="!hasImage && form.emoji === emoji" :aria-label="emoji" @click="form.emoji = form.emoji === emoji && !hasImage ? '' : emoji; form.avatar = ''">{{ emoji }}</button></div><div class="partner-face-colors" :class="{ 'has-image': hasImage }" :aria-disabled="hasImage"><button v-for="preset in palette" :key="preset" type="button" class="group-color" :aria-label="preset" :aria-pressed="form.color === preset" :disabled="hasImage" :style="{ background: preset }" @click="form.color = form.color === preset ? '' : preset"><span v-if="form.color === preset">●</span></button></div><div class="partner-face-upload"><label class="partner-upload-button"><LegacyIcon name="image" :size="14" /><span>{{ hasImage ? '更换图片' : '上传图片 / SVG' }}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" @change="uploadAvatar" /></label><button v-if="hasImage" type="button" @click="form.avatar = ''">× 移除</button></div></section><label class="partner-language">回复语言<select v-model="form.language" aria-label="回复语言"><option value="">自动（英文）</option><option value="en">English</option><option value="zh">中文</option><option value="uk">Українська</option></select></label><input class="partner-compat-name" aria-hidden="true" tabindex="-1" placeholder="伙伴叫什么？" v-model="form.name"></div></template>
      <template v-else-if="step === 1"><SoulPicker v-model:source="form.soulSource" v-model:soul-id="form.soulId" v-model:content="form.soul" :library="soulLibrary" :personas="personas" /></template>
      <template v-else-if="step === 2"><div class="partner-mind-fields"><section><h3>主模型</h3><PartnerModelPicker :options="llmOptions" :active-default="activeLLMDefault" :model-value="modelValue(form.profileId, form.modelId)" :loading="loading" @update:model-value="selectModel($event)" /></section><section><h3>备用模型</h3><PartnerModelSelect :options="llmOptions" :model-value="modelValue(form.backupProfileId, form.backupModelId)" :loading="loading" @update:model-value="selectModel($event, true)" /></section><PartnerToolPicker :tools="tools" :builtin-tools="builtinTools" :mcp-tools="mcpTools" :enabled="form.enabledTools" :builtin="form.builtinTools" :mcp="form.mcpTools" @update:enabled="form.enabledTools = $event; toolsTouched = true" @update:builtin="form.builtinTools = $event; toolsTouched = true" @update:mcp="form.mcpTools = $event; toolsTouched = true" /></div></template>
      <template v-else-if="step === 3"><div class="partner-library-fields"><PartnerWorkspacePicker v-model="form.workspaceId" :workspaces="workspaces" /><PartnerAssetPicker v-if="!form.workspaceId" :value="form.assets" :knowledge-bases="knowledgeBases.map(kb => ({ id: kb.name, label: kb.name }))" :skills="skills.map(skill => ({ id: skill.name, label: skill.name, hint: skill.description }))" :notebooks="notebooks.map(nb => ({ id: nb.id, label: nb.name, hint: nb.description }))" @change="form.assets = $event" /></div></template>
      <template v-else><div class="partner-review-step"><dl class="partner-review-list"><div><dt>名称</dt><dd>{{ form.name || '—' }}</dd></div><div><dt>简介</dt><dd>{{ form.description || '—' }}</dd></div><div><dt>灵魂</dt><dd>{{ soulSummary }}</dd></div><div><dt>工作区</dt><dd>{{ form.workspaceId ? workspaceName : 'Partner 私有工作区' }}</dd></div><div><dt>模型</dt><dd>{{ selectedModel ? `${selectedModel.profile_name} · ${selectedModel.model_name}` : '系统默认' }}</dd></div><div><dt>备用模型</dt><dd>{{ backupModel ? `${backupModel.profile_name} · ${backupModel.model_name}` : '不设备用' }}</dd></div><div><dt>工具</dt><dd>{{ form.enabledTools.length }} 系统工具<template v-if="form.mcpTools.length"> · {{ form.mcpTools.length }} MCP 工具</template></dd></div><div><dt>资料库</dt><dd>{{ form.workspaceId ? '实时共享工作区资源' : `将复制 ${form.assets.knowledge_bases.length + form.assets.skills.length + form.assets.notebooks.length} 项` }}</dd></div></dl><p>创建后即可接入飞书、Telegram、Slack 等频道。</p></div></template>
      </div><footer class="partner-wizard-actions"><button type="button" :disabled="step === 0 || busy" @click="step--">← 上一步</button><button class="primary" :aria-label="step === steps.length - 1 ? '创建并启动' : '下一步'" :disabled="busy || step === 0 && !form.name.trim()"><LegacyIcon v-if="step === steps.length - 1 && !busy" name="sparkles" :size="15" />{{ step === steps.length - 1 ? (busy ? '创建中…' : '创建伙伴') : '继续 →' }}</button></footer>
    </form></template>
    <template v-else><nav class="partner-page-bar" aria-label="位置"><div class="partner-crumb-wrap"><button type="button" class="partner-crumb" aria-haspopup="menu" :aria-expanded="partnerMenuOpen" @click.stop="partnerMenuOpen = !partnerMenuOpen"><span aria-hidden="true">◌</span>伙伴</button><template v-if="partnerMenuOpen"><div class="partner-menu-dismiss" @click="partnerMenuOpen = false"></div><div class="partner-resource-menu" role="menu" aria-label="伙伴"><p>伙伴</p><RouterLink role="menuitem" class="is-active" to="/partners" @click="partnerMenuOpen = false">伙伴</RouterLink></div></template></div></nav>
    <form class="group-create-form" @submit.prevent="create">
      <RouterLink to="/partners" class="group-create-back">← 伙伴</RouterLink>
      <header class="group-create-heading"><h1>创建伙伴群组</h1><p>先选至少两位伙伴，再决定他们怎么讨论。</p></header>
      <section class="group-create-preview"><span class="group-preview-avatar" :style="{ backgroundColor: `${form.color}2e`, color: form.color }">{{ form.emoji || '👥' }}</span><div><strong :class="{ muted: !form.name.trim() }">{{ form.name.trim() || '未命名群组' }}</strong><p v-if="form.description.trim()">{{ form.description }}</p><div class="group-preview-members"><div v-if="selectedPartners.length" class="avatar-stack"><PartnerAvatar v-for="partner in selectedPartners.slice(0, 6)" :key="partner.partner_id" :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="20" /></div><small>{{ form.member_ids.length < 2 ? `还需再选 ${2 - form.member_ids.length} 位伙伴` : `${form.member_ids.length} 位伙伴` }}</small></div></div></section>
      <div class="group-create-sections">
        <section><h2>名称</h2><div class="group-name-row"><input v-model="form.emoji" aria-label="表情符号" maxlength="4" class="group-emoji-input"><input v-model="form.name" aria-label="名称" maxlength="80" placeholder="群组名称" class="group-name-input"></div><textarea v-model="form.description" aria-label="描述" rows="2" maxlength="500" placeholder="这个群组要帮助你学习或决定什么？" class="group-description-input" /><div class="group-color-row"><button v-for="preset in palette" :key="preset" type="button" class="group-color" :aria-label="preset" :aria-pressed="form.color === preset" :style="{ background: preset }" @click="form.color = preset"><span v-if="form.color === preset" /></button></div></section>
        <section><div class="group-section-heading"><h2>成员</h2><span :class="{ ready: form.member_ids.length >= 2 }">已选择 {{ form.member_ids.length }} 项</span></div><div v-if="loading" class="group-members-loading" role="status">◌</div><div v-else-if="partners.length < 2" class="group-members-empty"><p>群组至少需要两位伙伴，先再创建一位。</p><RouterLink to="/partners/new" class="primary">＋ 新建伙伴</RouterLink></div><div v-else class="group-member-grid"><button v-for="partner in partners" :key="partner.partner_id" type="button" class="group-member-card" :class="{ selected: form.member_ids.includes(partner.partner_id) }" :aria-pressed="form.member_ids.includes(partner.partner_id)" @click="form.member_ids.includes(partner.partner_id) ? form.member_ids = form.member_ids.filter(id => id !== partner.partner_id) : form.member_ids.push(partner.partner_id)"><PartnerAvatar :name="partner.name" :emoji="partner.emoji" :color="partner.color" :image="partner.avatar" :size="34" /><span><strong>{{ partner.name }}</strong><small>{{ partner.description }}</small></span><i>{{ form.member_ids.includes(partner.partner_id) ? '✓' : '' }}</i></button></div><div class="legacy-sr-only" aria-hidden="true"><input v-for="partner in partners" :key="`compat-${partner.partner_id}`" v-model="form.member_ids" type="checkbox" :value="partner.partner_id" tabindex="-1"></div></section>
        <section v-if="modes.length > 1" class="group-mode-section"><h2>讨论方式</h2><div class="group-mode-list"><button v-for="mode in modes" :key="mode.name" type="button" class="group-mode-card" :class="{ selected: form.discussion_mode === mode.name }" :aria-pressed="form.discussion_mode === mode.name" @click="form.discussion_mode = mode.name"><i class="group-mode-radio"><LegacyIcon v-if="form.discussion_mode === mode.name" name="check" :size="10" /></i><span><strong>{{ modeLabel(mode.name) }}<em v-if="modeCost(mode)">{{ modeCost(mode) }}</em></strong><small>{{ modeHint(mode) }}</small></span></button></div><div class="legacy-sr-only" aria-hidden="true"><input v-for="mode in modes" :key="`compat-${mode.name}`" v-model="form.discussion_mode" type="radio" :value="mode.name" tabindex="-1"></div><p>无论哪种方式，每位伙伴的工具调用与中间思考都只有你能看到。</p></section>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p><div class="group-create-submit"><button class="primary" :disabled="busy || !form.name.trim() || form.member_ids.length < 2"><LegacyIcon name="partners" :size="14" />{{ busy ? '创建中…' : '创建群组' }}</button></div>
    </form></template>
  </main>
</template>
