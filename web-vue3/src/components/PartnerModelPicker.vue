<script setup lang="ts">
import LegacyIcon from './LegacyIcon.vue'

type LLMOption = { profile_id: string; model_id: string; profile_name: string; model_name: string; model?: string; provider?: string; provider_label?: string; context_window?: number }
type Selection = { profile_id: string; model_id: string } | null
const props = withDefaults(defineProps<{ options: LLMOption[]; activeDefault?: Selection; modelValue?: string; loading?: boolean; error?: boolean }>(), { activeDefault: null, modelValue: '', loading: false, error: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
function key(option: LLMOption) { return `${option.profile_id}:${option.model_id}` }
function formatContext(tokens?: number) { if (!tokens || tokens <= 0) return ''; if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`; if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`; return String(tokens) }
const defaultOption = () => props.activeDefault ? props.options.find(option => option.profile_id === props.activeDefault?.profile_id && option.model_id === props.activeDefault?.model_id) : undefined
</script>

<template>
  <div class="partner-model-picker">
    <p v-if="loading" class="partner-model-status"><span class="dt-spinner" />正在加载模型…</p>
    <p v-else-if="error" class="partner-model-status">无法加载模型目录——伙伴将使用系统默认模型。</p>
    <template v-else>
      <button type="button" class="partner-model-row" :class="{ selected: !modelValue }" @click="emit('update:modelValue', '')"><span><strong>系统默认</strong><small>{{ defaultOption() ? `${defaultOption()?.model_name || defaultOption()?.model} · ${defaultOption()?.provider_label || defaultOption()?.provider}` : '跟随系统当前默认模型。' }}</small></span><i><LegacyIcon v-if="!modelValue" name="check" :size="12" /></i></button>
      <button v-for="option in options" :key="key(option)" type="button" class="partner-model-row" :class="{ selected: modelValue === key(option) }" @click="emit('update:modelValue', key(option))"><span><strong>{{ option.model_name || option.model }}</strong><small>{{ option.provider_label || option.provider }} · {{ option.profile_name }}</small></span><em v-if="formatContext(option.context_window)">{{ formatContext(option.context_window) }}</em><i><LegacyIcon v-if="modelValue === key(option)" name="check" :size="12" /></i></button>
      <p v-if="!options.length" class="partner-model-status">还没有配置模型——请在 设置 → LLM 中添加。</p>
    </template>
  </div>
</template>
