<script setup lang="ts">
const props = withDefaults(defineProps<{ everyTurn: boolean; label?: string }>(), { label: '每轮都包含这些资源' })
const emit = defineEmits<{ 'update:everyTurn': [value: boolean] }>()
</script>
<template><label class="resource-reuse-toggle" :class="{ active: everyTurn }" :title="label"><input type="checkbox" :checked="everyTurn" :aria-label="label" @change="emit('update:everyTurn', ($event.target as HTMLInputElement).checked)"><span class="pin">⌖</span><span>{{ everyTurn ? '每轮' : '仅本轮' }}</span><i><b /></i></label></template>
