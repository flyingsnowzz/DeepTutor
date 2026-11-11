<script setup lang="ts">
import { computed } from 'vue'
import { AVATAR_ICON_PATHS } from '../avatarIcons'

const props = withDefaults(defineProps<{ name: string; size?: number; strokeWidth?: number }>(), {
  size: 18,
  strokeWidth: 1.8,
})
const markup = computed(() => AVATAR_ICON_PATHS[props.name] || AVATAR_ICON_PATHS.sparkles)
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g v-html="markup" /></svg>
</template>
