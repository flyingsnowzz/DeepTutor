<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: 'skill-deck' | 'connector-hub' | 'plain-voice' | 'mode-math-animator' | 'mode-visualize' | 'mode-ask-questions' | 'mode-deep-question' | 'mode-deep-solve' | 'mode-deep-research' | 'mode-audio-overview' | 'mode-video-lesson'; size?: number }>(), { size: 14 })
const markup = computed(() => {
  if (props.name === 'skill-deck') return `
    <path d="M8.75 6.5V5.25a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2V15.5a2 2 0 0 1-2 2h-1.5"/>
    <rect x="3.75" y="6.5" width="12.75" height="14.25" rx="2.25" class="dt-duo"/>
    <path d="M10.1 10.6c.3 1.6 1.25 2.55 2.85 2.85-1.6.3-2.55 1.25-2.85 2.85-.3-1.6-1.25-2.55-2.85-2.85 1.6-.3 2.55-1.25 2.85-2.85z" class="dt-duo-solid"/>`
  if (props.name === 'mode-math-animator') return `
    <rect x="2.75" y="4.5" width="18.5" height="15" rx="3" class="dt-duo"/>
    <path d="M5.75 12c1.25-3.5 2.5-3.5 3.75 0s2.5 3.5 3.75 0"/>
    <path d="M15.75 9.6v4.8l3.75-2.4z" class="dt-duo-solid"/>`
  if (props.name === 'mode-visualize') return `
    <path d="M11 5a8 8 0 1 0 8 8h-8z" class="dt-duo"/>
    <path d="M13 3v8h8a8 8 0 0 0-8-8z" class="dt-duo-solid"/>`
  if (props.name === 'mode-ask-questions') return `
    <path d="M5.5 3h13A2.5 2.5 0 0 1 21 5.5V15a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 3.5v-3.5h-2A2.5 2.5 0 0 1 3 15V5.5A2.5 2.5 0 0 1 5.5 3z" class="dt-duo"/>
    <path d="M9.65 8.35a2.35 2.35 0 1 1 3.525 2.035c-.72.42-1.175.9-1.175 1.6" stroke-width="1.8"/>
    <circle cx="12" cy="14.45" r=".95" class="dt-duo-solid" stroke="none"/>`
  if (props.name === 'mode-deep-question') return `
    <rect x="4" y="2.75" width="16" height="18.5" rx="3" class="dt-duo"/>
    <path d="m7.25 9 1.6 1.6 3.15-3.35" stroke-width="1.9"/>
    <path d="M14.25 9h2.5"/><circle cx="9.4" cy="15.25" r="1.75"/><path d="M14.25 15.25h2.5"/>`
  if (props.name === 'mode-deep-solve') return `
    <path d="M3 21v-4h6v-4h6V9h6v12z" class="dt-duo"/>
    <path d="M17.25 9V3.5"/>
    <path d="M17.25 3.5 21.5 5.4l-4.25 1.9z" class="dt-duo-solid"/>`
  if (props.name === 'mode-deep-research') return `
    <circle cx="10.5" cy="10.5" r="7.25" class="dt-duo"/>
    <path d="m15.75 15.75 5 5" stroke-width="2"/>
    <path d="M10.5 6.4c.4 2.15 1.55 3.3 3.7 3.7-2.15.4-3.3 1.55-3.7 3.7-.4-2.15-1.55-3.3-3.7-3.7 2.15-.4 3.3-1.55 3.7-3.7z" class="dt-duo-solid"/>`
  if (props.name === 'mode-audio-overview') return `
    <rect x="2.5" y="4.75" width="19" height="14.5" rx="7.25" class="dt-duo"/>
    <path d="M7 10.75v2.5M9.5 8.5v7M12 9.75v4.5M14.5 8v8M17 10.5v3" stroke-width="1.8"/>`
  if (props.name === 'mode-video-lesson') return `
    <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/>
    <path d="m6.2 5.3 3.1 3.9"/>
    <path d="m12.4 3.4 3.1 4"/>
    <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>`
  if (props.name === 'connector-hub') return `
    <circle cx="12" cy="12.6" r="2.1" class="dt-duo-solid"/>
    <circle cx="12" cy="4.2" r="2.3" class="dt-duo"/>
    <circle cx="4.7" cy="16.8" r="2.3" class="dt-duo"/>
    <circle cx="19.3" cy="16.8" r="2.3" class="dt-duo"/>
    <path d="M12 10.1V6.9M9.85 13.85l-3.1 1.8M14.15 13.85l3.1 1.8"/>`
  return `
    <path d="M12 4c4.42 0 8 2.95 8 6.6s-3.58 6.6-8 6.6c-.93 0-1.82-.13-2.65-.37L5.1 18.75l1.05-3.35C4.8 14.2 4 12.5 4 10.6 4 6.95 7.58 4 12 4z" class="dt-duo"/>
    <path d="M8.75 9.35h6.5M8.75 12.35h3.75"/>`
})
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="markup" />
</template>
