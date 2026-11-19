<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { api } from '../api'
interface Resources { skills: string[] | null; mcp: string[] | null; knowledge_bases: string[] | null }
interface Option { id: string; name: string; description?: string; source?: string; provenance_label?: string; available?: boolean }
const props = withDefaults(defineProps<{ modelValue: Resources; workspaceId?: string; language?: string }>(), { workspaceId: '' })
const emit = defineEmits<{ 'update:modelValue': [value: Resources] }>()
const tr = (zh: string, en: string) => props.language === 'en' ? en : zh
const catalog = ref<Record<keyof Resources, Option[]> | null>(null)
const error = ref('')
const groups = computed((): { key: keyof Resources; label: string; href: string }[] => [{ key: 'skills', label: tr('技能', 'Skills'), href: '/space/skills' }, { key: 'mcp', label: tr('MCP 服务', 'MCP servers'), href: '/space/mcp' }, { key: 'knowledge_bases', label: tr('知识库', 'Knowledge bases'), href: '/knowledge-bases' }])
let loadVersion = 0
async function load() {
  const version = ++loadVersion
  catalog.value = null
  error.value = ''
  try {
    const result = await api<Record<keyof Resources, Option[]>>(`/api/settings/workspace/resources?workspace_id=${encodeURIComponent(props.workspaceId)}`)
    if (version === loadVersion) catalog.value = result
  } catch (cause) {
    if (version === loadVersion) error.value = cause instanceof Error ? cause.message : tr('资源加载失败', 'Failed to load resources')
  }
}
watch(() => props.workspaceId, load, { immediate: true })
onUnmounted(() => { loadVersion++ })
function setMode(key: keyof Resources, mode: string) { emit('update:modelValue', { ...props.modelValue, [key]: mode === 'inherit' ? null : [] }) }
function toggle(key: keyof Resources, id: string) { const selected = props.modelValue[key] ?? []; emit('update:modelValue', { ...props.modelValue, [key]: selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id] }) }
function missing(key: keyof Resources) { if (!catalog.value) return []; const items = catalog.value[key] ?? []; return (props.modelValue[key] ?? []).filter(id => !items.some(item => item.id === id)) }
</script>
<template><div class="workspace-resource-picker"><div><h4>{{ tr('分配的资源', 'Assigned resources') }}</h4><p>{{ tr('资源在学习空间中管理。分配只创建引用，移除分配不会删除原资源。', 'Resources are managed in Learning Space. Assigning them creates references; removing an assignment keeps the original resource.') }}</p></div><p v-if="error" class="error" role="alert">{{ error }} <button @click="load">{{ tr('重试', 'Retry') }}</button></p><fieldset v-for="group in groups" :key="group.key"><legend>{{ group.label }}</legend><div class="workspace-resource-mode"><select :value="modelValue[group.key] === null ? 'inherit' : 'selected'" :aria-label="`${group.label} ${tr('分配模式', 'assignment mode')}`" @change="setMode(group.key, ($event.target as HTMLSelectElement).value)"><option value="inherit">{{ tr('继承可用资源', 'Inherit available resources') }}</option><option value="selected">{{ tr('仅选中的资源', 'Selected resources only') }}</option></select><RouterLink :to="group.href">{{ tr('管理资源库', 'Manage resources') }}</RouterLink></div><p v-if="modelValue[group.key] === null" class="muted">{{ tr('保留现有访问规则，新可用资源会自动包含。', 'Keep existing access rules; new available resources are included automatically.') }}</p><template v-else><p v-if="!catalog && !error" class="muted">{{ tr('正在加载资源…', 'Loading resources…') }}</p><p v-else-if="catalog && !(catalog[group.key] || []).length" class="muted">{{ tr('暂无可用资源，请先在学习空间添加。', 'No resources available. Add them in Learning Space first.') }}</p><div class="workspace-resource-options"><label v-for="item in catalog?.[group.key] || []" :key="item.id"><input type="checkbox" :checked="modelValue[group.key]?.includes(item.id)" @change="toggle(group.key, item.id)"><span><strong>{{ item.name }}</strong><small>{{ item.provenance_label || item.source || tr('个人', 'Personal') }}<template v-if="item.available === false"> · {{ tr('当前不可用', 'Unavailable') }}</template></small><small v-if="item.description">{{ item.description }}</small></span></label><label v-for="id in missing(group.key)" :key="id"><input type="checkbox" checked @change="toggle(group.key, id)"><span>{{ id }} — {{ tr('资源不存在或访问已移除', 'Resource missing or access removed') }}</span></label></div><p class="muted">{{ modelValue[group.key]?.length ? tr(`已选择 ${modelValue[group.key]?.length} 项资源`, `${modelValue[group.key]?.length} resources selected`) : tr('未选择资源，此类型在工作区不可用。', 'No resources selected; this type is unavailable in the workspace.') }}</p></template></fieldset></div></template>
