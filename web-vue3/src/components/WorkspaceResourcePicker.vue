<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
interface Resources { skills: string[] | null; mcp: string[] | null; knowledge_bases: string[] | null }
interface Option { id: string; name: string; description?: string; source?: string; provenance_label?: string; available?: boolean }
const props = withDefaults(defineProps<{ modelValue: Resources; workspaceId?: string }>(), { workspaceId: '' })
const emit = defineEmits<{ 'update:modelValue': [value: Resources] }>()
const catalog = ref<Record<keyof Resources, Option[]> | null>(null)
const error = ref('')
const groups: { key: keyof Resources; label: string; href: string }[] = [{ key: 'skills', label: '技能', href: '/space/skills' }, { key: 'mcp', label: 'MCP 服务', href: '/space/mcp' }, { key: 'knowledge_bases', label: '知识库', href: '/knowledge-bases' }]
async function load() { error.value = ''; try { catalog.value = await api<Record<keyof Resources, Option[]>>(`/api/settings/workspace/resources?workspace_id=${encodeURIComponent(props.workspaceId)}`) } catch (cause) { error.value = cause instanceof Error ? cause.message : '资源加载失败' } }
onMounted(load)
function setMode(key: keyof Resources, mode: string) { emit('update:modelValue', { ...props.modelValue, [key]: mode === 'inherit' ? null : [] }) }
function toggle(key: keyof Resources, id: string) { const selected = props.modelValue[key] ?? []; emit('update:modelValue', { ...props.modelValue, [key]: selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id] }) }
function missing(key: keyof Resources) { const items = catalog.value?.[key] ?? []; return (props.modelValue[key] ?? []).filter(id => !items.some(item => item.id === id)) }
</script>
<template><div class="workspace-resource-picker"><p>资源在学习空间中管理。分配只创建引用，移除分配不会删除原资源。</p><p v-if="error" class="error" role="alert">{{ error }} <button @click="load">重试</button></p><fieldset v-for="group in groups" :key="group.key"><legend>{{ group.label }}</legend><div class="workspace-resource-mode"><select :value="modelValue[group.key] === null ? 'inherit' : 'selected'" :aria-label="`${group.label} 分配模式`" @change="setMode(group.key, ($event.target as HTMLSelectElement).value)"><option value="inherit">继承可用资源</option><option value="selected">仅选中的资源</option></select><RouterLink :to="group.href">管理资源库</RouterLink></div><p v-if="modelValue[group.key] === null" class="muted">保留现有访问规则，新可用资源会自动包含。</p><template v-else><p v-if="!catalog" class="muted">正在加载资源…</p><p v-else-if="!(catalog[group.key] || []).length" class="muted">暂无可用资源，请先在学习空间添加。</p><div class="workspace-resource-options"><label v-for="item in catalog?.[group.key] || []" :key="item.id"><input type="checkbox" :checked="modelValue[group.key]?.includes(item.id)" @change="toggle(group.key, item.id)"><span><strong>{{ item.name }}</strong><small>{{ item.provenance_label || item.source || '个人' }}<template v-if="item.available === false"> · 当前不可用</template></small><small v-if="item.description">{{ item.description }}</small></span></label><label v-for="id in missing(group.key)" :key="id"><input type="checkbox" checked @change="toggle(group.key, id)"><span>{{ id }} — 资源不存在或访问已移除</span></label></div><p class="muted">{{ modelValue[group.key]?.length ? `已选择 ${modelValue[group.key]?.length} 项资源` : '未选择资源，此类型在工作区不可用。' }}</p></template></fieldset></div></template>
