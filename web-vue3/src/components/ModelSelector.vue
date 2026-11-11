<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'

interface LLMOption {
  profile_id: string
  model_id: string
  profile_name: string
  model_name: string
  provider?: string
  provider_label?: string
  model?: string
  context_window?: number
  is_active_default?: boolean
}
const props = withDefaults(defineProps<{ options?: LLMOption[]; value?: string }>(), { options: () => [], value: '' })
const emit = defineEmits<{ select: [value: string] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const showLabel = ref(false)
let labelTimer: ReturnType<typeof setTimeout> | undefined
const selected = computed(() => props.options.find(option => `${option.profile_id}:${option.model_id}` === props.value) || null)
const label = computed(() => selected.value?.model || selected.value?.model_name || '选择模型')
function choose(value: string) {
  emit('select', value)
  open.value = false
  showLabel.value = true
  if (labelTimer) clearTimeout(labelTimer)
  labelTimer = setTimeout(() => { showLabel.value = false }, 1200)
}
function formatContext(value?: number) {
  if (!value) return ''
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M ctx`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k ctx`
  return `${value} ctx`
}
function outside(event: MouseEvent) { if (open.value && !root.value?.contains(event.target as Node)) open.value = false }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') open.value = false }
onMounted(() => { document.addEventListener('click', outside); document.addEventListener('keydown', keydown) })
onUnmounted(() => { document.removeEventListener('click', outside); document.removeEventListener('keydown', keydown); if (labelTimer) clearTimeout(labelTimer) })
</script>

<template>
  <div ref="root" class="model-selector">
    <button type="button" class="model-selector-trigger" aria-label="选择模型" :aria-expanded="open" :disabled="!options.length" @click="open = !open"><LegacyIcon name="model" :size="16" /><span class="model-selector-label" :class="{ show: showLabel }"><span>{{ label }}</span><LegacyIcon name="chevronDown" :size="12" /></span></button>
    <div v-if="open" class="model-selector-menu" role="dialog" aria-label="选择模型">
      <button v-for="option in options" :key="`${option.profile_id}:${option.model_id}`" type="button" role="option" :aria-selected="`${option.profile_id}:${option.model_id}` === value" @click="choose(`${option.profile_id}:${option.model_id}`)">
        <LegacyIcon name="model" :size="14" />
        <span class="model-option-name">{{ option.model || option.model_name }}</span>
        <span v-if="option.is_active_default" class="model-option-default">默认</span>
        <small>{{ option.provider_label || option.provider || option.profile_name }}</small>
        <em v-if="option.context_window">{{ formatContext(option.context_window) }}</em>
        <LegacyIcon v-if="`${option.profile_id}:${option.model_id}` === value" name="check" :size="14" />
      </button>
      <p v-if="!options.length">没有可用模型</p>
    </div>
  </div>
</template>
