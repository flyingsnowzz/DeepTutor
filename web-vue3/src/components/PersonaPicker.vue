<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import ResourceReuseToggle from './ResourceReuseToggle.vue'
import { api } from '../api'

interface Persona { name: string; description?: string; content?: string }
const props = withDefaults(defineProps<{ open: boolean; initial: string; everyTurn?: boolean }>(), { everyTurn: false })
const emit = defineEmits<{ close: []; apply: [name: string]; 'update:everyTurn': [value: boolean] }>()
const personas = ref<Persona[]>([])
const selected = ref('')
const query = ref('')
const loading = ref(false)
const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return keyword ? personas.value.filter(persona => `${persona.name} ${persona.description || ''}`.toLowerCase().includes(keyword)) : personas.value
})
async function load() {
  loading.value = true
  try { personas.value = (await api<{ personas: Persona[] }>('/api/personas')).personas || [] }
  catch { personas.value = [] } finally { loading.value = false }
}
function close() { emit('close') }
function apply() { emit('apply', selected.value); close() }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
watch(() => props.open, open => { if (open) { selected.value = props.initial; query.value = ''; void load() } })
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template><Teleport to="body"><div v-if="open" class="picker-overlay" @click.self="close"><section class="persona-picker" role="dialog" aria-modal="true" aria-labelledby="persona-picker-title">
  <header><div class="picker-icon"><LegacyIcon name="profile" :size="18" /></div><div><h2 id="persona-picker-title">选择 Persona</h2><p>选择本轮应用的行为 Persona，或使用默认助手行为。</p></div><ResourceReuseToggle :every-turn="everyTurn" @update:every-turn="emit('update:everyTurn', $event)" /><button type="button" aria-label="关闭" @click="close"><LegacyIcon name="close" :size="18" /></button></header>
  <div class="persona-picker-body"><button type="button" class="persona-none" :class="{ selected: !selected }" @click="selected = ''"><span class="persona-radio"><LegacyIcon v-if="!selected" name="check" :size="12" /></span><span><strong>不使用 Persona</strong><small>本轮使用默认助手行为。</small></span></button>
    <div class="picker-search"><LegacyIcon name="search" :size="15" /><input v-model="query" type="search" placeholder="按名称或描述搜索 Persona" /></div>
    <div class="persona-list"><div v-if="loading" class="picker-loading"><span class="mastery-spinner" /></div><div v-else-if="!filtered.length" class="picker-empty">没有找到 Persona</div><template v-else><button v-for="persona in filtered" :key="persona.name" type="button" class="persona-row" :class="{ selected: selected === persona.name }" @click="selected = persona.name"><span class="persona-radio"><LegacyIcon v-if="selected === persona.name" name="check" :size="12" /></span><span><strong>{{ persona.name }}</strong><small>{{ persona.description || '无描述' }}</small></span></button></template></div>
  </div><footer><span>{{ selected || '默认' }}</span><div><button type="button" @click="close">取消</button><button type="button" class="primary" @click="apply">应用 Persona</button></div></footer>
</section></div></Teleport></template>
