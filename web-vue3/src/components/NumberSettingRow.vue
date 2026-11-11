<script setup lang="ts">
const props = withDefaults(defineProps<{ title: string; description?: string; value: number; min?: number; max?: number; step?: number; float?: boolean }>(), { min: 0, max: 200000, step: 1, float: false })
const emit = defineEmits<{ change: [value: number] }>()
function update(event: Event) { const raw = (event.target as HTMLInputElement).value; if (raw === '') return; const value = props.float ? Number.parseFloat(raw) : Number.parseInt(raw, 10); if (!Number.isNaN(value)) emit('change', value) }
</script>
<template><div class="legacy-setting-row"><div><h3>{{ title }}</h3><p v-if="description">{{ description }}</p></div><input class="legacy-setting-number" type="number" :value="value" :min="min" :max="max" :step="step" :aria-label="title" @input="update"></div></template>
