<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import type { NoteMetadataPatch, NotePage } from '../notes/noteTypes'

const props = defineProps<{ page: NotePage; disabled: boolean }>()
const emit = defineEmits<{
  title: [value: string]
  metadata: [patch: NoteMetadataPatch]
}>()
const PAGE_ICONS = [
  '📘', '📗', '📙', '📕', '📓', '📒', '📝', '✏️',
  '📌', '🔖', '🧠', '💡', '🔬', '🧪', '🧬', '🧮',
  '📐', '🗺️', '🌍', '🌱', '🌊', '🔥', '⭐', '✨',
  '🎯', '🎨', '🎵', '🏛️', '⚛️', '🧭', '📊', '📈',
  '🗂️', '✅', '❓', '💬', '🪐', '🦉', '🍎', '☕',
]
const PAGE_COVERS = [
  '#e6e4dc', '#dce5dd', '#dce3eb', '#eee0d6', '#e6deeb', '#efe6c8',
  'linear-gradient(120deg, #e8e2d4 0%, #d6e2e9 100%)',
  'linear-gradient(120deg, #f1dfd2 0%, #e5dcef 100%)',
  'linear-gradient(120deg, #d9e8dc 0%, #e8efcf 100%)',
  'linear-gradient(120deg, #dfe6f3 0%, #f1e4ec 100%)',
]
const root = ref<HTMLElement | null>(null)
const titleElement = ref<HTMLTextAreaElement | null>(null)
const iconOpen = ref(false)
const coverOpen = ref(false)
const customIcon = ref('')

async function resizeTitle() {
  await nextTick()
  const element = titleElement.value
  if (!element) return
  element.style.height = '0px'
  element.style.height = `${element.scrollHeight}px`
}
watch(() => props.page.title, resizeTitle, { immediate: true })
function closePickers() {
  iconOpen.value = false
  coverOpen.value = false
  customIcon.value = ''
}
function outside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) closePickers()
}
function escape(event: KeyboardEvent) { if (event.key === 'Escape') closePickers() }
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', escape)
  void resizeTitle()
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', escape)
})
function pickIcon(icon: string) { closePickers(); emit('metadata', { icon }) }
function pickCover(cover: string) { closePickers(); emit('metadata', { cover }) }
function submitCustomIcon() { if (customIcon.value.trim()) pickIcon(customIcon.value.trim()) }
function focusEditor(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  const editor = root.value?.closest('.dt-note-document')?.querySelector<HTMLElement>('.rich-note-content')
  if (editor) editor.focus()
  else (event.target as HTMLElement).blur()
}
</script>

<template>
  <div ref="root" class="dt-note-head" :class="{ 'has-cover': page.cover, 'has-icon': page.icon }">
    <div v-if="page.cover" class="dt-note-cover" :style="{ background: page.cover }">
      <div class="dt-note-cover-actions">
        <div class="relative">
          <button class="dt-note-ghost" :disabled="disabled" aria-haspopup="menu" :aria-expanded="coverOpen" @click="coverOpen = !coverOpen; iconOpen = false">更换封面</button>
          <div v-if="coverOpen" class="dt-popover dt-note-picker" role="menu">
            <div class="dt-menu-label">封面</div>
            <div class="dt-note-cover-grid">
              <button v-for="cover in PAGE_COVERS" :key="cover" role="menuitemradio" :aria-label="`设置封面 ${cover}`" :aria-checked="page.cover === cover" :style="{ background: cover }" @click="pickCover(cover)" />
            </div>
            <div class="dt-menu-divider" />
            <button role="menuitem" class="dt-menu-item is-quiet" @click="pickCover('')">移除封面</button>
          </div>
        </div>
      </div>
    </div>
    <div class="dt-note-head-body">
      <div v-if="page.icon" class="relative dt-note-page-icon-wrap">
        <button class="dt-note-page-icon" :disabled="disabled" aria-label="更换图标" aria-haspopup="menu" :aria-expanded="iconOpen" @click="iconOpen = !iconOpen; coverOpen = false">{{ page.icon }}</button>
        <div v-if="iconOpen" class="dt-popover dt-note-picker" role="menu">
          <div class="dt-menu-label">页面图标</div>
          <div class="dt-note-icon-grid"><button v-for="icon in PAGE_ICONS" :key="icon" role="menuitemradio" :aria-label="icon" :aria-checked="page.icon === icon" @click="pickIcon(icon)">{{ icon }}</button></div>
          <form class="dt-note-icon-custom" @submit.prevent="submitCustomIcon"><input v-model="customIcon" aria-label="任意表情符号" placeholder="粘贴任意表情…" maxlength="10"></form>
          <div class="dt-menu-divider" /><button role="menuitem" class="dt-menu-item is-quiet" @click="pickIcon('')">移除图标</button>
        </div>
      </div>
      <div class="dt-note-head-tools">
        <div v-if="!page.icon" class="relative">
          <button class="dt-note-ghost" :disabled="disabled" aria-haspopup="menu" :aria-expanded="iconOpen" @click="iconOpen = !iconOpen; coverOpen = false"><LegacyIcon name="smilePlus" :size="15" />添加图标</button>
          <div v-if="iconOpen" class="dt-popover dt-note-picker" role="menu">
            <div class="dt-menu-label">页面图标</div>
            <div class="dt-note-icon-grid"><button v-for="icon in PAGE_ICONS" :key="icon" role="menuitemradio" :aria-label="icon" :aria-checked="page.icon === icon" @click="pickIcon(icon)">{{ icon }}</button></div>
            <form class="dt-note-icon-custom" @submit.prevent="submitCustomIcon"><input v-model="customIcon" aria-label="任意表情符号" placeholder="粘贴任意表情…" maxlength="10"></form>
          </div>
        </div>
        <div v-if="!page.cover" class="relative">
          <button class="dt-note-ghost" :disabled="disabled" aria-haspopup="menu" :aria-expanded="coverOpen" @click="coverOpen = !coverOpen; iconOpen = false"><LegacyIcon name="image" :size="15" />添加封面</button>
          <div v-if="coverOpen" class="dt-popover dt-note-picker" role="menu">
            <div class="dt-menu-label">封面</div>
            <div class="dt-note-cover-grid"><button v-for="cover in PAGE_COVERS" :key="cover" role="menuitemradio" :aria-label="`设置封面 ${cover}`" :aria-checked="page.cover === cover" :style="{ background: cover }" @click="pickCover(cover)" /></div>
          </div>
        </div>
      </div>
      <textarea
        ref="titleElement"
        rows="1"
        :disabled="disabled"
        aria-label="页面标题"
        placeholder="未命名页面"
        class="dt-note-page-title co-writer-title"
        :value="page.title"
        @input="emit('title', ($event.target as HTMLTextAreaElement).value)"
        @keydown="focusEditor"
      />
    </div>
  </div>
</template>
