<script setup lang="ts">
defineProps<{ title: string; description?: string; checked: boolean }>()
const emit = defineEmits<{ change: [value: boolean] }>()
</script>
<template><div class="legacy-setting-row"><div><h3>{{ title }}</h3><p v-if="description">{{ description }}</p></div><button type="button" role="switch" :aria-label="title" :aria-checked="checked" class="legacy-toggle" :class="{ on: checked }" @click="emit('change', !checked)"><span /></button></div></template>
