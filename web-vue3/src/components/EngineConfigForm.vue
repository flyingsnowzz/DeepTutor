<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ modelValue: Record<string, any> }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()
const entries = computed(() => Object.entries(props.modelValue))
function isSecret(key: string) { return /api.?key|token|secret|password/i.test(key) }
function set(key: string, value: unknown) { emit('update:modelValue', { ...props.modelValue, [key]: value }) }
function setJson(key: string, raw: string) { try { set(key, JSON.parse(raw)) } catch { /* Keep the previous valid value while editing. */ } }
</script>

<template>
  <div class="engine-config-form"><label v-for="[key, value] in entries" :key="key">{{ key }}<input v-if="typeof value === 'boolean'" type="checkbox" :checked="value" @change="set(key, ($event.target as HTMLInputElement).checked)"><input v-else-if="typeof value === 'number'" type="number" :value="value" @change="set(key, Number(($event.target as HTMLInputElement).value))"><input v-else-if="typeof value === 'string' || value === null" :type="isSecret(key) ? 'password' : 'text'" :value="value ?? ''" @change="set(key, ($event.target as HTMLInputElement).value)"><textarea v-else rows="4" :value="JSON.stringify(value, null, 2)" @change="setJson(key, ($event.target as HTMLTextAreaElement).value)" /></label></div>
</template>
