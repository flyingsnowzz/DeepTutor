<script setup lang="ts">
import LegacyIcon from './LegacyIcon.vue'
import {
  DEFAULT_READER_DISPLAY_PREFERENCES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  nextLineWidth,
  nextReaderTheme,
  type ReaderDisplayPreferences,
} from '../readingDisplay'

withDefaults(defineProps<{
  preferences: ReaderDisplayPreferences
  showSpread?: boolean
}>(), { showSpread: false })
const emit = defineEmits<{ change: [value: Partial<ReaderDisplayPreferences>] }>()
</script>

<template>
  <div class="reader-display-controls">
    <button type="button" aria-label="缩小文字" :disabled="preferences.fontSize <= MIN_FONT_SIZE" @click="emit('change', { fontSize: Math.max(MIN_FONT_SIZE, preferences.fontSize - 1) })"><LegacyIcon name="minus" :size="14" /></button>
    <button type="button" aria-label="放大文字" :disabled="preferences.fontSize >= MAX_FONT_SIZE" @click="emit('change', { fontSize: Math.min(MAX_FONT_SIZE, preferences.fontSize + 1) })"><LegacyIcon name="plus" :size="14" /></button>
    <button type="button" :aria-label="preferences.serif ? '使用无衬线字体' : '使用衬线字体'" :aria-pressed="!preferences.serif" @click="emit('change', { serif: !preferences.serif })"><LegacyIcon name="fileText" :size="14" /></button>
    <button type="button" :aria-label="`调整阅读宽度（当前 ${preferences.lineWidth} 字符）`" @click="emit('change', { lineWidth: nextLineWidth(preferences.lineWidth) })"><LegacyIcon name="tableOfContents" :size="14" /></button>
    <button type="button" aria-label="切换阅读主题" :aria-pressed="preferences.readerTheme !== 'auto'" @click="emit('change', { readerTheme: nextReaderTheme(preferences.readerTheme) })"><LegacyIcon name="appearance" :size="14" /></button>
    <button v-if="showSpread" type="button" :aria-label="preferences.spreadMode === 'none' ? '切换双页' : '切换单页'" :aria-pressed="preferences.spreadMode === 'auto'" @click="emit('change', { spreadMode: preferences.spreadMode === 'none' ? 'auto' : 'none' })"><LegacyIcon name="columns" :size="14" /></button>
    <button type="button" aria-label="重置阅读显示" @click="emit('change', { ...DEFAULT_READER_DISPLAY_PREFERENCES })"><LegacyIcon name="rotateCcw" :size="14" /></button>
  </div>
</template>

<style scoped>
.reader-display-controls{display:flex;align-items:center;gap:1px;flex:0 0 auto}
.reader-display-controls>button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;opacity:.68;cursor:pointer}
.reader-display-controls>button:hover{background:color-mix(in srgb,currentColor 10%,transparent);opacity:1}
.reader-display-controls>button[aria-pressed=true]{opacity:1}
.reader-display-controls>button:disabled{opacity:.3;cursor:not-allowed}
</style>
