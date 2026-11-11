<script setup lang="ts">
import { computed } from 'vue'
import {
  RESEARCH_DEPTHS,
  RESEARCH_MODES,
  validateResearchConfig,
  type DeepResearchFormConfig,
} from '../research'

const props = defineProps<{
  modelValue: DeepResearchFormConfig
  errors?: Record<string, string>
}>()
const emit = defineEmits<{
  'update:modelValue': [DeepResearchFormConfig]
}>()

const localErrors = computed(() => props.errors ?? validateResearchConfig(props.modelValue).errors)

function patch<K extends keyof DeepResearchFormConfig>(key: K, value: DeepResearchFormConfig[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
function setSubtopics(value: string) {
  const n = Number(value)
  patch('manual_subtopics', n)
}
function setIterations(value: string) {
  const n = Number(value)
  patch('manual_max_iterations', n)
}
</script>

<template>
  <section class="research-config-panel">
    <div class="research-config-grid">
      <label class="research-config-field">
        <span class="research-config-label">研究类型</span>
        <select
          class="research-config-select"
          :value="modelValue.mode"
          @change="patch('mode', ($event.target as HTMLSelectElement).value as DeepResearchFormConfig['mode'])"
        >
          <option value="" disabled>请选择类型</option>
          <option v-for="m in RESEARCH_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
        <small v-if="localErrors.mode" class="research-config-error">{{ localErrors.mode }}</small>
      </label>

      <label class="research-config-field">
        <span class="research-config-label">研究深度</span>
        <select
          class="research-config-select"
          :value="modelValue.depth"
          @change="patch('depth', ($event.target as HTMLSelectElement).value as DeepResearchFormConfig['depth'])"
        >
          <option value="" disabled>请选择深度</option>
          <option v-for="d in RESEARCH_DEPTHS" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
        <small v-if="localErrors.depth" class="research-config-error">{{ localErrors.depth }}</small>
      </label>
    </div>

    <div v-if="modelValue.depth === 'manual'" class="research-config-manual">
      <label class="research-config-field">
        <span class="research-config-label">手动子主题数</span>
        <input
          type="number"
          class="research-config-input"
          min="1"
          max="10"
          :value="modelValue.manual_subtopics ?? ''"
          @input="setSubtopics(($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="research-config-field">
        <span class="research-config-label">最大迭代次数</span>
        <input
          type="number"
          class="research-config-input"
          min="1"
          max="8"
          :value="modelValue.manual_max_iterations ?? 3"
          @input="setIterations(($event.target as HTMLInputElement).value)"
        >
      </label>
    </div>
  </section>
</template>
