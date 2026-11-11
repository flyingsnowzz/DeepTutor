<script setup lang="ts">
import { reactive } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import MarkdownView from './MarkdownView.vue'
import type { NoteBlock } from '../notes/noteTypes'
defineProps<{ blocks: NoteBlock[] }>()
const expanded = reactive<Record<string, boolean>>({})
function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'markdown' in value) return String(value.markdown)
  return ''
}
</script>
<template>
  <section v-for="block in blocks.filter(item => item.type === 'clip')" :key="block.id" class="dt-note-favorite" :class="{ 'is-open': expanded[block.id] }">
    <div class="dt-note-favorite-head">
      <button class="dt-note-favorite-toggle" :aria-expanded="expanded[block.id]" :aria-label="`${String(block.props.title || '收藏内容')} · 已保存原文`" @click="expanded[block.id] = !expanded[block.id]"><LegacyIcon name="bookmark" :size="17" /><span class="min-w-0 flex-1 text-left"><span class="dt-note-favorite-kind">{{ String(block.props.favoriteType || '收藏') }} · 已保存原文</span><strong class="dt-note-favorite-title">{{ String(block.props.title || '收藏内容') }}</strong><span v-if="block.props.summary && !expanded[block.id]" class="dt-note-favorite-summary">{{ String(block.props.summary) }}</span></span></button>
      <div class="dt-note-favorite-tools"><a v-if="block.props.sourceUrl" data-note-source :href="String(block.props.sourceUrl)" aria-label="返回来源"><LegacyIcon name="cornerUpRight" :size="15" /></a><button :aria-label="expanded[block.id] ? '隐藏原文' : '查看原文'" @click="expanded[block.id] = !expanded[block.id]"><LegacyIcon name="chevronDown" :size="16" :class="{ 'rotate-180': expanded[block.id] }" /></button></div>
    </div>
    <div v-if="expanded[block.id]" class="dt-note-favorite-body"><MarkdownView :content="String(block.props.markdown || text(block.content))" /></div>
  </section>
</template>
