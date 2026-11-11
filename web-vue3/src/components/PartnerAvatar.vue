<script setup lang="ts">
withDefaults(defineProps<{ name: string; emoji?: string; color?: string; image?: string; size?: number }>(), { size: 40 })
</script>

<template>
  <img v-if="image" class="partner-avatar-image" :src="image" alt="" aria-hidden="true" :style="{ width: `${size}px`, height: `${size}px` }">
  <span v-else class="partner-avatar" aria-hidden="true" :style="{ width: `${size}px`, height: `${size}px`, background: color || (emoji ? '#edf1ee' : '#b0501e'), fontSize: `${size * (emoji ? 0.55 : 0.42)}px` }">{{ emoji || (name.trim().charAt(0).toUpperCase() || '?') }}</span>
</template>
