<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'

interface ToolParameter { name: string; type: string; description: string; required: boolean; enum?: string[] }
interface ToolHints { short_description: string; when_to_use: string; input_format: string; guideline: string; note: string; aliases: { name: string; description: string; phase: string }[] }
interface BuiltinTool { name: string; description: string; parameters: ToolParameter[]; hints: Partial<Record<string, ToolHints>> & { en: ToolHints }; aliases: string[]; toggleable: boolean; enabled: boolean; coming_soon?: boolean; capability?: string | null; available?: boolean; unavailable_reason?: string | null }
interface ToolsResponse { tools: BuiltinTool[]; enabled_optional_tools: string[] }
const props = defineProps<{ enabledTools: string[] }>()
const emit = defineEmits<{ change: [value: string[]]; loaded: [value: string[]] }>()
const tools = ref<BuiltinTool[] | null>(null)
const error = ref('')
const query = ref('')
const expanded = ref(new Set<string>())
const enabled = computed(() => new Set(props.enabledTools))
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
  if (experience.length) result.push({ key: 'experience', label: '体验增强', hint: '用户可选；按需为 chat agent 开启或关闭。', tools: experience })
  if (builtin.length) result.push({ key: 'builtin', label: '内置工具', hint: 'Chat agent 在需要时自动挂载，无需手动开关。', tools: builtin })
  const labels: Record<string, string> = { solve: '深度解题', mastery: '精通路径' }
  for (const [capability, list] of capabilities) result.push({ key: `cap:${capability}`, label: `${labels[capability] || capability} · 能力工具`, hint: '该能力的专属工具，仅在此能力运行时挂载。', tools: list })
  return result
})
const filteredGroups = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return groups.value
  return groups.value.map(group => ({ ...group, tools: group.tools.filter(tool => {
    const hints = tool.hints?.zh || tool.hints?.en
    const text = [tool.name, tool.description, ...(tool.aliases ?? []), hints?.short_description, hints?.when_to_use, hints?.input_format, hints?.guideline, hints?.note, ...(tool.parameters ?? []).flatMap(parameter => [parameter.name, parameter.type, parameter.description, ...(parameter.enum ?? [])])].filter(Boolean).join(' ').toLocaleLowerCase()
    return text.includes(needle)
  }) })).filter(group => group.tools.length)
})
function hintsFor(tool: BuiltinTool) { return tool.hints?.zh || tool.hints?.en }
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
  if (tool.available !== false) return ''
  const reason = tool.unavailable_reason || ''
  const labels: Record<string, string> = { missing_api_key: '未配置密钥', missing_dependency: '缺少依赖', disabled: '已停用', not_configured: '未配置' }
  return labels[reason] || '当前不可用'
}
onMounted(async () => {
  error.value = ''
  try {
    const payload = await api<ToolsResponse>('/api/tools')
    tools.value = payload.tools
    emit('loaded', payload.enabled_optional_tools ?? [])
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '工具加载失败' }
})
</script>

<template>
  <div>
    <header class="legacy-settings-page-header"><h1>工具</h1><p>开启或关闭用户可选工具。锁定工具会在对话智能体需要时自动挂载。</p></header>
    <div class="legacy-tools-search"><LegacyIcon name="search" :size="16" /><input v-model="query" aria-label="搜索工具" placeholder="搜索工具" type="search" spellcheck="false"><button v-if="query" type="button" aria-label="清除" @click="query = ''"><LegacyIcon name="close" :size="14" /></button></div>
    <p v-if="error" class="error" role="alert">工具加载失败：{{ error }}</p>
    <p v-else-if="!tools" class="legacy-settings-loading">加载中…</p>
    <div v-else-if="query.trim() && !filteredGroups.length" class="legacy-tools-empty">没有与“{{ query.trim() }}”匹配的工具。</div>
    <div v-else class="legacy-tools-groups">
      <section v-for="group in filteredGroups" :key="group.key">
        <header><div><h2>{{ group.label }}</h2><p>{{ group.hint }}</p></div><span>{{ group.tools.length }}</span></header>
        <div class="legacy-tools-list">
          <article v-for="tool in group.tools" :key="tool.name">
            <div class="legacy-tool-row"><LegacyIcon name="tool" :size="14" />
              <button type="button" class="legacy-tool-summary" :aria-expanded="expanded.has(tool.name)" @click="toggleExpanded(tool.name)"><div><div class="legacy-tool-name"><code>{{ tool.name }}</code><small v-if="tool.aliases?.length">{{ tool.aliases.join(' · ') }}</small><span v-if="tool.coming_soon" class="legacy-tool-badge">敬请期待</span><span v-else-if="availability(tool)" class="legacy-tool-badge warning">{{ availability(tool) }}</span></div><p>{{ hintsFor(tool)?.short_description || tool.description }}</p><p v-if="availability(tool)" class="legacy-tool-unavailable">当前运行环境无法使用此工具。</p></div><LegacyIcon name="chevronDown" :size="16" :class="{ rotated: expanded.has(tool.name) }" /></button>
              <button v-if="tool.toggleable && !tool.coming_soon && tool.available !== false" type="button" role="switch" :aria-checked="enabled.has(tool.name)" :aria-label="enabled.has(tool.name) ? '开启' : '关闭'" class="legacy-tool-switch" :class="{ on: enabled.has(tool.name) }" @click="toggleTool(tool)"><span /></button>
              <span v-else-if="tool.coming_soon || tool.available === false" class="legacy-tool-locked">{{ tool.coming_soon ? '敬请期待' : availability(tool) }}</span>
              <span v-else class="legacy-tool-locked">🔒 始终开启</span>
            </div>
            <div v-if="expanded.has(tool.name)" class="legacy-tool-details">
              <div v-if="hintsFor(tool)?.when_to_use"><h3>何时使用</h3><p>{{ hintsFor(tool)?.when_to_use }}</p></div>
              <div v-if="hintsFor(tool)?.input_format"><h3>输入格式</h3><p><code>{{ hintsFor(tool)?.input_format }}</code></p></div>
              <div v-if="hintsFor(tool)?.guideline"><h3>使用准则</h3><p>{{ hintsFor(tool)?.guideline }}</p></div>
              <div v-if="hintsFor(tool)?.note"><h3>说明</h3><p>{{ hintsFor(tool)?.note }}</p></div>
              <div v-if="tool.parameters?.length"><h3>参数</h3><ul><li v-for="parameter in tool.parameters" :key="parameter.name"><code>{{ parameter.name }}</code><small>{{ parameter.type }}<template v-if="!parameter.required"> · 可选</template></small><span v-if="parameter.description">— {{ parameter.description }}</span></li></ul></div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
