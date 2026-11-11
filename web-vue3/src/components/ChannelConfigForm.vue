<script setup lang="ts">
import { computed, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'

const props = defineProps<{ schema: Record<string, any>; modelValue: Record<string, any>; secretFields?: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()
const revealed = ref<Set<string>>(new Set())
function toggleReveal(key: string) { const next = new Set(revealed.value); if (next.has(key)) next.delete(key); else next.add(key); revealed.value = next }
const properties = computed(() => Object.entries(props.schema.properties || {}) as [string, any][])
function value(key: string) { return props.modelValue[key] }
function set(key: string, value: unknown) { emit('update:modelValue', { ...props.modelValue, [key]: value }) }
function setList(key: string, value: string) { set(key, value.split('\n').map(item => item.trim()).filter(Boolean)) }
</script>

<template>
  <div class="channel-schema-form">
    <label v-for="[key, field] in properties" :key="key">{{ field.title || key }}<select v-if="field.enum" :value="value(key) ?? field.default" @change="set(key, ($event.target as HTMLSelectElement).value)"><option v-for="option in field.enum" :key="option" :value="option">{{ option }}</option></select><input v-else-if="field.type === 'boolean'" type="checkbox" :checked="Boolean(value(key) ?? field.default)" @change="set(key, ($event.target as HTMLInputElement).checked)"><input v-else-if="field.type === 'integer' || field.type === 'number'" type="number" :value="value(key) ?? field.default ?? ''" :min="field.minimum" :max="field.maximum" @change="set(key, Number(($event.target as HTMLInputElement).value))"><textarea v-else-if="field.type === 'array'" rows="2" :value="Array.isArray(value(key)) ? value(key).join('\n') : ''" @change="setList(key, ($event.target as HTMLTextAreaElement).value)" /><template v-else-if="secretFields?.includes(key)"><div class="channel-secret-control"><input :type="revealed.has(key) ? 'text' : 'password'" :value="value(key) ?? field.default ?? ''" :placeholder="field.description" @change="set(key, ($event.target as HTMLInputElement).value)"><button type="button" :aria-label="revealed.has(key) ? '隐藏密钥' : '显示密钥'" @click="toggleReveal(key)"><LegacyIcon name="eye" :size="14" :stroke-width="1.8" /></button></div></template><input v-else type="text" :value="value(key) ?? field.default ?? ''" :placeholder="field.description" @change="set(key, ($event.target as HTMLInputElement).value)"><small v-if="field.description">{{ field.description }}</small></label>
  </div>
</template>
