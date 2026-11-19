<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'

interface ToolParameter { name: string; type: string; description: string; required: boolean; enum?: string[] }
interface ToolHints { short_description: string; when_to_use: string; input_format: string; guideline: string; note: string; aliases: { name: string; description: string; phase: string }[] }
interface BuiltinTool { name: string; description: string; parameters: ToolParameter[]; hints: Partial<Record<string, ToolHints>> & { en: ToolHints }; aliases: string[]; toggleable: boolean; enabled: boolean; coming_soon?: boolean; capability?: string | null; available?: boolean; unavailable_reason?: string | null }
interface ToolsResponse { tools: BuiltinTool[]; enabled_optional_tools: string[] }
const props = defineProps<{ enabledTools: string[]; language?: string; revision?: number }>()
const emit = defineEmits<{ change: [value: string[]]; loaded: [value: string[]] }>()
const tools = ref<BuiltinTool[] | null>(null)
const error = ref('')
const query = ref('')
const expanded = ref(new Set<string>())
const enabled = computed(() => new Set(props.enabledTools))
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
let loadVersion = 0
const groups = computed(() => {
  const experience: BuiltinTool[] = []
  const builtin: BuiltinTool[] = []
  const capabilities = new Map<string, BuiltinTool[]>()
  for (const tool of tools.value ?? []) {
    if (tool.capability) capabilities.set(tool.capability, [...capabilities.get(tool.capability) ?? [], tool])
    else if (tool.toggleable || tool.coming_soon) experience.push(tool)
    else builtin.push(tool)
  }
  const result: { key: string; label: string; hint: string; tools: BuiltinTool[] }[] = []
  if (experience.length) result.push({ key: 'experience', label: tr('体验增强', 'Experience Enhancement'), hint: tr('用户可选；按需为 chat agent 开启或关闭。', "User-toggleable. Switch on or off to shape the chat agent's behavior."), tools: experience })
  if (builtin.length) result.push({ key: 'builtin', label: tr('内置工具', 'Built-in Tools'), hint: tr('Chat agent 在需要时自动挂载，无需手动开关。', 'Mounted automatically by the chat agent when needed. Not user-toggleable.'), tools: builtin })
  const labels: Record<string, string> = { solve: tr('深度解题', 'Deep Solve'), mastery: tr('精通路径', 'Mastery Path') }
  for (const [capability, list] of capabilities) result.push({ key: `cap:${capability}`, label: `${labels[capability] || capability} · ${tr('能力工具', 'Capability Tools')}`, hint: tr('该能力的专属工具，仅在此能力运行时挂载。', 'Tools specific to this capability; mounted only when it runs.'), tools: list })
  return result
})
const filteredGroups = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return groups.value
  return groups.value.map(group => ({ ...group, tools: group.tools.filter(tool => {
    const hints = hintsFor(tool)
    const other = tool.hints?.[chinese.value ? 'en' : 'zh'] || tool.hints?.en
    const text = [tool.name, tool.description, ...(tool.aliases ?? []), ...[hints, other].flatMap(item => [item?.short_description, item?.when_to_use, item?.input_format, item?.guideline, item?.note, ...(item?.aliases ?? []).flatMap(alias => [alias.name, alias.description, alias.phase])]), ...(tool.parameters ?? []).flatMap(parameter => [parameter.name, parameter.type, parameter.description, ...(parameter.enum ?? [])])].filter(Boolean).join(' ').toLocaleLowerCase()
    return text.includes(needle)
  }) })).filter(group => group.tools.length)
})
function hintsFor(tool: BuiltinTool) { return tool.hints?.[chinese.value ? 'zh' : 'en'] || tool.hints?.en }
function toggleExpanded(name: string) {
  const next = new Set(expanded.value)
  if (next.has(name)) next.delete(name); else next.add(name)
  expanded.value = next
}
function toggleTool(tool: BuiltinTool) {
  if (!tool.toggleable || tool.coming_soon || tool.available === false) return
  const next = new Set(props.enabledTools)
  if (next.has(tool.name)) next.delete(tool.name); else next.add(tool.name)
  emit('change', [...next].sort())
}
function availability(tool: BuiltinTool) {
  if (tool.available !== false) return null
  if (tool.unavailable_reason === 'search_provider_not_configured') return { badge: tr('未配置', 'Not configured'), detail: tr('请先在搜索设置中选择提供商。DuckDuckGo 无需 API 密钥。', 'Choose a provider in Search settings first. DuckDuckGo needs no API key.'), href: '/settings/search' }
  if (tool.unavailable_reason === 'search_credentials_missing') return { badge: tr('缺少凭证', 'Credentials missing'), detail: tr('当前搜索提供商缺少所需凭证，请检查搜索设置。', 'The selected search provider needs credentials. Check Search settings.'), href: '/settings/search' }
  return { badge: tr('暂不可用', 'Unavailable'), detail: tr('该工具的运行服务当前不可用。', "This tool's runtime service is unavailable."), href: '' }
}
async function load() {
  const version = ++loadVersion
  error.value = ''
  try {
    const payload = await api<ToolsResponse>('/api/tools')
    if (version !== loadVersion) return
    tools.value = payload.tools
    emit('loaded', payload.enabled_optional_tools ?? [])
  } catch (cause) { if (version === loadVersion) error.value = cause instanceof Error ? cause.message : tr('工具加载失败', 'Failed to load tools') }
}
onMounted(() => { void load() })
watch(() => props.revision, () => { void load() })
onUnmounted(() => { loadVersion += 1 })
</script>

<template>
  <div>
    <header class="legacy-settings-page-header"><h1>{{ tr('工具', 'Tools') }}</h1><p>{{ tr('开启或关闭用户可选工具。锁定工具会在对话智能体需要时自动挂载。', 'Switch user-toggleable tools on or off. Locked tools are mounted automatically when the chat agent needs them.') }}</p></header>
    <div class="legacy-tools-search"><LegacyIcon name="search" :size="16" /><input v-model="query" :aria-label="tr('搜索工具', 'Search tools')" :placeholder="tr('搜索工具', 'Search tools')" type="search" spellcheck="false"><button v-if="query" type="button" :aria-label="tr('清除', 'Clear')" @click="query = ''"><LegacyIcon name="close" :size="14" /></button></div>
    <p v-if="error" class="error" role="alert">{{ tr('工具加载失败', 'Failed to load tools') }}: {{ error }}</p>
    <p v-else-if="!tools" class="legacy-settings-loading">{{ tr('加载中…', 'Loading...') }}</p>
    <div v-else-if="query.trim() && !filteredGroups.length" class="legacy-tools-empty">{{ tr('没有与“', 'No tools match “') }}{{ query.trim() }}{{ tr('”匹配的工具。', '”.') }}</div>
    <div v-else class="legacy-tools-groups">
      <section v-for="group in filteredGroups" :key="group.key">
        <header><div><h2>{{ group.label }}</h2><p>{{ group.hint }}</p></div><span>{{ group.tools.length }}</span></header>
        <div class="legacy-tools-list">
          <article v-for="tool in group.tools" :key="tool.name">
            <div class="legacy-tool-row"><LegacyIcon name="tool" :size="14" />
              <button type="button" class="legacy-tool-summary" :aria-expanded="expanded.has(tool.name)" @click="toggleExpanded(tool.name)"><div><div class="legacy-tool-name"><code>{{ tool.name }}</code><small v-if="tool.aliases?.length">{{ tool.aliases.join(' · ') }}</small><span v-if="tool.coming_soon" class="legacy-tool-badge">{{ tr('敬请期待', 'Coming soon') }}</span><span v-else-if="availability(tool)" class="legacy-tool-badge warning">{{ availability(tool)?.badge }}</span></div><p>{{ hintsFor(tool)?.short_description || tool.description }}</p><p v-if="availability(tool) && !tool.coming_soon" class="legacy-tool-unavailable">{{ availability(tool)?.detail }} <RouterLink v-if="availability(tool)?.href" :to="availability(tool)!.href">{{ tr('打开设置', 'Open settings') }}</RouterLink></p></div><LegacyIcon name="chevronDown" :size="16" :class="{ rotated: expanded.has(tool.name) }" /></button>
              <button v-if="tool.toggleable && !tool.coming_soon && tool.available !== false" type="button" role="switch" :aria-checked="enabled.has(tool.name)" :aria-label="enabled.has(tool.name) ? tr('开启', 'On') : tr('关闭', 'Off')" class="legacy-tool-switch" :class="{ on: enabled.has(tool.name) }" @click="toggleTool(tool)"><span /></button>
              <button v-else-if="tool.coming_soon || tool.available === false" type="button" role="switch" aria-checked="false" :aria-label="tool.coming_soon ? tr('敬请期待', 'Coming soon') : availability(tool)?.badge" class="legacy-tool-switch" disabled><span /></button>
              <span v-else class="legacy-tool-locked">🔒 {{ tr('始终开启', 'Always on') }}</span>
            </div>
            <div v-if="expanded.has(tool.name)" class="legacy-tool-details">
              <div v-if="hintsFor(tool)?.when_to_use"><h3>{{ tr('何时使用', 'When to use') }}</h3><p>{{ hintsFor(tool)?.when_to_use }}</p></div>
              <div v-if="hintsFor(tool)?.input_format"><h3>{{ tr('输入格式', 'Input format') }}</h3><p><code>{{ hintsFor(tool)?.input_format }}</code></p></div>
              <div v-if="hintsFor(tool)?.guideline"><h3>{{ tr('使用准则', 'Guideline') }}</h3><p>{{ hintsFor(tool)?.guideline }}</p></div>
              <div v-if="hintsFor(tool)?.note"><h3>{{ tr('说明', 'Note') }}</h3><p>{{ hintsFor(tool)?.note }}</p></div>
              <div v-if="tool.parameters?.length"><h3>{{ tr('参数', 'Parameters') }}</h3><ul><li v-for="parameter in tool.parameters" :key="parameter.name"><code>{{ parameter.name }}</code><small>{{ parameter.type }}<template v-if="!parameter.required"> · {{ tr('可选', 'optional') }}</template></small><span v-if="parameter.description">— {{ parameter.description }}</span></li></ul></div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
