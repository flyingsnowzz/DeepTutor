<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'

type LLMOption = { profile_id: string; model_id: string; profile_name: string; model_name: string; model?: string; provider?: string; provider_label?: string; context_window?: number }
const props = withDefaults(defineProps<{ options: LLMOption[]; modelValue?: string; loading?: boolean; error?: boolean }>(), { modelValue: '', loading: false, error: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const current = computed(() => props.options.find(option => key(option) === props.modelValue))
function key(option: LLMOption) { return `${option.profile_id}:${option.model_id}` }
function formatContext(tokens?: number) { if (!tokens || tokens <= 0) return ''; if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`; if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`; return String(tokens) }
function choose(value: string) { emit('update:modelValue', value); open.value = false }
function onPointerDown(event: PointerEvent) { if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false }
function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') open.value = false }
onMounted(() => { document.addEventListener('pointerdown', onPointerDown); document.addEventListener('keydown', onKeyDown) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) })
</script>

<template>
  <div ref="root" class="partner-model-select">
    <p v-if="loading" class="partner-model-status"><span class="dt-spinner" />正在加载模型…</p>
    <p v-else-if="error" class="partner-model-status">无法加载模型目录——该伙伴将使用系统默认模型。</p>
    <template v-else>
      <button type="button" aria-haspopup="listbox" :aria-expanded="open" @click="open = !open">
        <span><strong>{{ current ? current.model_name || current.model : '不设备用' }}</strong><small>{{ current ? `${current.provider_label || current.provider} · ${current.profile_name}` : '失败的轮次不会重试。' }}</small></span>
        <LegacyIcon name="chevronDown" :size="16" />
      </button>
      <div v-if="open" class="partner-model-menu" role="listbox">
        <button type="button" role="option" :aria-selected="!modelValue" @click="choose('')"><span><strong>不设备用</strong><small>失败的轮次不会重试。</small></span><LegacyIcon v-if="!modelValue" name="check" :size="12" /></button>
        <button v-for="option in options" :key="key(option)" type="button" role="option" :aria-selected="modelValue === key(option)" @click="choose(key(option))"><span><strong>{{ option.model_name || option.model }}</strong><small>{{ option.provider_label || option.provider }} · {{ option.profile_name }}</small></span><em v-if="formatContext(option.context_window)">{{ formatContext(option.context_window) }}</em><LegacyIcon v-if="modelValue === key(option)" name="check" :size="12" /></button>
        <p v-if="!options.length" class="partner-model-status">还没有配置模型——请在 设置 → LLM 中添加。</p>
      </div>
    </template>
  </div>
</template>
