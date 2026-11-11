<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(defineProps<{ kind?: string; size?: number }>(), { size: 16 })
const gradientId = `agent-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
const imageSource = computed(() => ({
  kimi: '/agent-icons/kimi.svg',
  opencode: '/agent-icons/opencode.svg',
  mimo: '/agent-icons/mimo-code.svg',
  hermes: '/agent-icons/hermes.svg',
  hermes_remote: '/agent-icons/hermes.svg',
  openclaw: '/agent-icons/openclaw.svg',
  deepseek_harness: '/agent-icons/deepseek-harness.svg',
} as Record<string, string>)[props.kind || ''] || '')
</script>

<template>
  <svg v-if="kind === 'codex'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect width="24" height="24" rx="4.5" fill="#fff" />
    <path d="M9.06 3.34a4.58 4.58 0 0 1 2.29-.31c1 .12 1.89.54 2.67 1.28l.04.02h.04a4.55 4.55 0 0 1 3.05.28l.05.02.12.06a4.58 4.58 0 0 1 2.18 2.4c.21.51.32 1.04.32 1.59a4.24 4.24 0 0 1-.13 1.23l.03.11c.59.61.99 1.33 1.18 2.17.29 1.43 0 2.71-.89 3.86l-.13.16a4.55 4.55 0 0 1-2.2 1.39l-.08.08c-.2.55-.39 1.02-.74 1.49-.9 1.19-2.23 1.85-3.72 1.84-1.18 0-2.24-.44-3.15-1.3l-.11-.03c-.39.13-.78.15-1.2.14a4.44 4.44 0 0 1-1.95-.46 4.54 4.54 0 0 1-1.61-1.34 4.9 4.9 0 0 1-.41-.62 5.8 5.8 0 0 1-.37-.96 4.58 4.58 0 0 1-.02-2.3l.01-.05-.03-.05a4.47 4.47 0 0 1-1.03-1.65 3.9 3.9 0 0 1-.25-1.19 5.2 5.2 0 0 1 .14-1.6c.34-1.11.98-1.99 1.93-2.62.21-.14.41-.25.6-.33.22-.09.43-.16.65-.23l.06-.06a4.5 4.5 0 0 1 .83-1.62 4.54 4.54 0 0 1 1.84-1.39Z" :fill="`url(#${gradientId})`" />
    <path d="M12.55 13.91a.64.64 0 0 0 0 1.27h3.64a.64.64 0 1 0 0-1.27h-3.64ZM8.46 9.23a.64.64 0 0 0-1.1.63l1.27 2.23-1.27 2.14a.64.64 0 0 0 1.1.64l1.45-2.45a.64.64 0 0 0 0-.64L8.46 9.23Z" fill="#172B4D" />
    <defs><linearGradient :id="gradientId" x1="12" x2="12" y1="3" y2="21" gradientUnits="userSpaceOnUse"><stop stop-color="#B1A7FF" /><stop offset=".5" stop-color="#7A9DFF" /><stop offset="1" stop-color="#3941FF" /></linearGradient></defs>
  </svg>
  <svg v-else-if="kind === 'claude_code'" :width="size" :height="size" viewBox="0 0 24 24" fill="#D97757" aria-hidden="true">
    <path d="M11.2 1.5h1.6l.55 5.4 2.4-4.85 1.45.7-2.1 5.02 4.2-3.44 1.05 1.2-3.9 3.75 5.18-1.6.55 1.5-5.35 1.45 5.2 1.58-.63 1.47-5.1-1.84 3.84 3.84-1.12 1.12-3.65-4.02 1.6 5.27-1.5.46-1.4-5.42-1.4 5.42-1.5-.46 1.6-5.27-3.65 4.02-1.12-1.12 3.84-3.84-5.1 1.84-.63-1.47 5.2-1.58-5.35-1.45.55-1.5 5.18 1.6-3.9-3.75 1.05-1.2 4.2 3.44-2.1-5.02 1.45-.7 2.4 4.85z" />
  </svg>
  <svg v-else-if="kind === 'grok'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="4" /><path d="m7 8 4 4-4 4m7 0h3" /></svg>
  <svg v-else-if="kind === 'antigravity'" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 24A14.3 14.3 0 0 0 0 12 14.3 14.3 0 0 0 12 0a14.3 14.3 0 0 0 12 12 14.3 14.3 0 0 0-12 12Z" :fill="`url(#${gradientId})`" /><defs><linearGradient :id="gradientId" x1="0" x2="24" y1="24" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#217BFE" /><stop offset="1" stop-color="#AC87EB" /></linearGradient></defs></svg>
  <svg v-else-if="imageSource" :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true"><image :href="imageSource" width="24" height="24" preserveAspectRatio="xMidYMid meet" /></svg>
  <span v-else class="agent-glyph-fallback" :style="{ width: `${size}px`, height: `${size}px` }" />
</template>

<style scoped>
.agent-glyph-fallback{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:4px;color:var(--muted-foreground)}
.agent-glyph-fallback::after{content:"◆";font-size:8px}
</style>
