<script setup lang="ts">
import { computed } from 'vue'
import LegacyIcon from './LegacyIcon.vue'

const props = withDefaults(defineProps<{ engine?: string | null; size?: number }>(), { engine: '', size: 20 })
const icons: Record<string, string> = {
  llamaindex: '/knowledge-engine-icons/llamaindex.png',
  pageindex: '/knowledge-engine-icons/pageindex.png',
  'pageindex-oss': '/knowledge-engine-icons/pageindex.png',
  graphrag: '/knowledge-engine-icons/graphrag.png',
  lightrag: '/knowledge-engine-icons/lightrag.jpg',
  'lightrag-server': '/knowledge-engine-icons/lightrag.jpg',
  ima: '/knowledge-engine-icons/tencent-ima.svg',
  obsidian: '/knowledge-engine-icons/obsidian.svg',
  marginnote4: '/knowledge-engine-icons/marginnote.png',
}
const source = computed(() => icons[props.engine || ''])
</script>

<template><img v-if="source" :src="source" alt="" aria-hidden="true" :width="size" :height="size" draggable="false" class="knowledge-engine-mark"><LegacyIcon v-else name="database" :size="size" /></template>
<style scoped>.knowledge-engine-mark{display:block;flex:none;object-fit:contain;user-select:none}</style>
