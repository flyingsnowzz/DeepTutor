<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'

type MemoryFile = 'summary' | 'profile'
const props = withDefaults(defineProps<{ open: boolean; initial: MemoryFile[]; everyTurn?: boolean }>(), { everyTurn: false })
const emit = defineEmits<{ close: []; apply: [files: MemoryFile[]]; 'update:everyTurn': [value: boolean] }>()
const selected = ref<MemoryFile[]>([])
const options: Array<{ key: MemoryFile; label: string; description: string; icon: string }> = [
  { key: 'summary', label: '摘要', description: '注入助手对过去学习会话的持续摘要。', icon: 'memory' },
  { key: 'profile', label: '档案', description: '注入学习者档案，包括偏好、目标和背景。', icon: 'profile' },
]
function toggle(key: MemoryFile) {
  selected.value = selected.value.includes(key) ? selected.value.filter(item => item !== key) : [...selected.value, key]
}
function clear() { selected.value = [] }
function close() { emit('close') }
function apply() { if (selected.value.length) { emit('apply', [...selected.value]); close() } }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
watch(() => props.open, open => { if (open) selected.value = [...props.initial] })
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template><Teleport to="body"><div v-if="open" class="picker-overlay" @click.self="close"><section class="memory-picker" role="dialog" aria-modal="true" aria-labelledby="memory-picker-title">
  <header><div class="picker-icon"><LegacyIcon name="memory" :size="18" /></div><div><h2 id="memory-picker-title">选择记忆</h2><p>选择要附加到本轮对话的长期记忆工件。</p></div><ResourceReuseToggle :every-turn="everyTurn" @update:every-turn="emit('update:everyTurn', $event)" /><button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="18" /></button></header>
  <div class="memory-picker-list"><button v-for="option in options" :key="option.key" type="button" class="memory-option" :class="{ selected: selected.includes(option.key) }" @click="toggle(option.key)"><span class="memory-check"><LegacyIcon v-if="selected.includes(option.key)" name="check" :size="12" /></span><LegacyIcon :name="option.icon" :size="15" /><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span></button></div>
  <footer><span>{{ selected.length ? `已选择 ${selected.length} 个记忆工件` : '未选择记忆' }}</span><div><button type="button" @click="clear">清空</button><button type="button" class="primary" :disabled="!selected.length" @click="apply">使用所选记忆（{{ selected.length }}）</button></div></footer>
</section></div></Teleport></template>
