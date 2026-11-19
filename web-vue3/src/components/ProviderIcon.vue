<script setup lang="ts">
import { computed } from 'vue'
import { providerIconSpec } from '../providerBranding'

const props = withDefaults(defineProps<{ provider?: string | null; size?: number }>(), { size: 13 })
const spec = computed(() => providerIconSpec(props.provider))
</script>

<template>
  <span class="provider-icon" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <template v-if="spec">
      <img :src="`/provider-icons/${spec.file}`" alt="" draggable="false" :class="{ mono: spec.mono, light: spec.darkFile }">
      <img v-if="spec.darkFile" :src="`/provider-icons/${spec.darkFile}`" alt="" draggable="false" class="dark-image">
    </template>
    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg>
  </span>
</template>

<style scoped>
.provider-icon{display:inline-flex;flex:none;align-items:center;justify-content:center}.provider-icon img,.provider-icon svg{width:100%;height:100%;object-fit:contain}.provider-icon .dark-image{display:none}:global(.dark) .provider-icon .light{display:none}:global(.dark) .provider-icon .dark-image{display:block}:global(.dark) .provider-icon .mono{filter:invert(1)}
</style>
