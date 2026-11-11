<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ color?: string; files?: number; size?: number }>(), { color: '', files: 0, size: 56 })
const tones: Record<string, string> = { '': '#a8a29e', blue: '#4f86f7', teal: '#1fb5a8', green: '#43b05c', amber: '#eaa221', orange: '#f07b3f', rose: '#e8577a', violet: '#8e6cf0', slate: '#6b7a90' }
const tone = computed(() => props.color.startsWith('#') ? props.color : (tones[props.color] || tones['']))
const sheets = computed(() => Math.min(Math.max(props.files, 0), 3))
const height = computed(() => props.size * 50 / 64)
</script>
<template><svg viewBox="0 0 64 50" :width="size" :height="height" aria-hidden="true"><path d="M4 8a4 4 0 0 1 4-4h13.6a4 4 0 0 1 2.9 1.2L28 9h28a4 4 0 0 1 4 4v29a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" :fill="`color-mix(in srgb, ${tone} 82%, black)`"/><rect v-for="index in sheets" :key="index" :x="10 + (index - 1) * 3" :y="12 - (index - 1) * 2.5" :width="44 - (index - 1) * 6" height="28" rx="2" fill="var(--card)" :stroke="`color-mix(in srgb, ${tone} 35%, var(--border))`" :stroke-width="0.8"/><path d="M4 20a4 4 0 0 1 4-4h48a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" :fill="tone"/><path d="M8 16.5h48" stroke="white" stroke-opacity=".45" stroke-width=".8"/></svg>
</template>
