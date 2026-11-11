<script setup lang="ts">
import { computed } from 'vue'
import { CLI_BRAND_ICONS, CLI_ICON_SLUGS } from '../cliBrandIcons'

const props = withDefaults(defineProps<{ id: string; name: string; size?: 'sm' | 'lg' }>(), { size: 'sm' })
const icon = computed(() => {
  const raw = props.id.trim()
  const lowered = raw.toLowerCase()
  const dashed = lowered.replace(/[\s_.]+/g, '-')
  const stripped = dashed.replace(/^cli-/, '').replace(/-cli$/, '')
  for (const key of [...new Set([raw, lowered, dashed, stripped])]) {
    const slug = CLI_ICON_SLUGS[key]
    if (slug && CLI_BRAND_ICONS[slug]) return CLI_BRAND_ICONS[slug]
  }
  return null
})
const initials = computed(() => {
  const cleaned = props.name.trim()
  if (!cleaned) return '?'
  const words = cleaned.split(/[\s\-_./]+/).filter(Boolean)
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
})
</script>

<template>
  <span class="cli-brand-icon" :class="`is-${size}`" aria-hidden="true">
    <svg v-if="icon" viewBox="0 0 24 24" :width="size === 'lg' ? 20 : 14" :height="size === 'lg' ? 20 : 14" fill="currentColor" role="presentation"><path :d="icon.path" /></svg>
    <template v-else>{{ initials }}</template>
  </span>
</template>
