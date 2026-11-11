<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { sameLLMSelection, type LLMOption, type LLMSelection } from '../partnerModel'

const props = defineProps<{
  options: LLMOption[]
  activeDefault: LLMSelection | null
  value: LLMSelection | null
  loading: boolean
  error: boolean
  noneLabel: string
  noneDetail?: string
}>()
const emit = defineEmits<{ change: [selection: LLMSelection | null] }>()
const root = ref<HTMLElement | null>(null)
const open = ref(false)

function formatContext(tokens?: number): string {
  if (!tokens || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

const current = computed(() => props.value ? props.options.find(option => sameLLMSelection(option, props.value)) : undefined)
const defaultOption = computed(() => props.activeDefault ? props.options.find(option => sameLLMSelection(option, props.activeDefault)) : undefined)
const currentTitle = computed(() => {
  if (!props.value) return props.noneLabel
  return current.value ? (current.value.model_name || current.value.model) : props.value.model_id
})
const currentSubtitle = computed(() => {
  if (props.value) {
    return current.value ? `${current.value.provider_label || current.value.provider} · ${current.value.profile_name}` : ''
  }
  if (props.noneDetail) return props.noneDetail
  return defaultOption.value ? `${defaultOption.value.model_name || defaultOption.value.model} · ${defaultOption.value.provider_label || defaultOption.value.provider}` : ''
})

function choose(selection: LLMSelection | null) {
  emit('change', selection)
  open.value = false
}
function onPointerDown(event: PointerEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false
}
function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div ref="root" class="partner-model-dropdown">
    <div v-if="loading" class="partner-model-dropdown-status"><LegacyIcon name="loader" :size="14" class="is-spinning" />正在加载模型…</div>
    <p v-else-if="error" class="partner-model-dropdown-error">无法加载模型目录——该伙伴将使用系统默认模型。</p>
    <template v-else>
      <button type="button" class="partner-model-dropdown-trigger" :class="{ open }" aria-haspopup="listbox" :aria-expanded="open" @click="open = !open">
        <span><strong>{{ currentTitle }}</strong><small v-if="currentSubtitle">{{ currentSubtitle }}</small></span>
        <LegacyIcon name="chevronDown" :size="16" />
      </button>
      <div v-if="open" class="partner-model-dropdown-menu" role="listbox">
        <button type="button" role="option" :aria-selected="value === null" :class="{ selected: value === null }" @click="choose(null)">
          <span><strong>{{ noneLabel }}</strong><small v-if="noneDetail">{{ noneDetail }}</small></span>
          <LegacyIcon v-if="value === null" name="check" :size="14" />
        </button>
        <button v-for="option in options" :key="`${option.profile_id}:${option.model_id}`" type="button" role="option" :aria-selected="value !== null && sameLLMSelection(option, value)" :class="{ selected: value !== null && sameLLMSelection(option, value) }" @click="choose({ profile_id: option.profile_id, model_id: option.model_id })">
          <span><strong>{{ option.model_name || option.model }}</strong><small>{{ option.provider_label || option.provider }} · {{ option.profile_name }}</small></span>
          <em v-if="formatContext(option.context_window)">{{ formatContext(option.context_window) }}</em>
          <LegacyIcon v-if="value !== null && sameLLMSelection(option, value)" name="check" :size="14" />
        </button>
        <p v-if="!options.length">还没有配置模型——请在 设置 → LLM 中添加。</p>
      </div>
    </template>
  </div>
</template>
