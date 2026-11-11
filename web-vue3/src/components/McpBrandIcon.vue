<script setup lang="ts">
import { computed } from 'vue'
import { MCP_BRAND_ICONS, MCP_ICON_SLUGS } from '../mcpBrandIcons'

const props = withDefaults(defineProps<{ id: string; name: string; size?: 'sm' | 'lg' }>(), { size: 'sm' })
const icon = computed(() => {
  const raw = props.id.trim()
  const lowered = raw.toLowerCase()
  const dashed = lowered.replace(/[\s_.]+/g, '-')
  const stripped = dashed.replace(/^cli-/, '').replace(/-cli$/, '')
  for (const key of [...new Set([raw, lowered, dashed, stripped])]) {
    const slug = MCP_ICON_SLUGS[key]
    if (slug && MCP_BRAND_ICONS[slug]) return MCP_BRAND_ICONS[slug]
  }
  return null
})
const initials = computed(() => {
  const words = props.name.trim().split(/[\s\-_./]+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase()
  return props.name.trim().slice(0, 2).toUpperCase()
})
</script>

<template>
  <span class="mcp-brand-icon" :class="`is-${size}`" aria-hidden="true">
    <svg v-if="icon" viewBox="0 0 24 24" :width="size === 'lg' ? 20 : 14" :height="size === 'lg' ? 20 : 14" fill="currentColor" role="presentation"><path :d="icon.path" /></svg>
    <template v-else>{{ initials }}</template>
  </span>
</template>
