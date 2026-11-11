<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import type { NoteBlock } from '../notes/noteTypes'

const props = defineProps<{
  blocks: NoteBlock[] | null
  scroller: HTMLElement | null
  open: boolean
  roomy: boolean
}>()
const emit = defineEmits<{ toggle: []; jump: [id: string] }>()
const current = ref<string | null>(null)
const peek = ref(false)
let frame = 0
let observedScroller: HTMLElement | null = null

function inlineText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(raw => {
    if (typeof raw === 'string') return raw
    if (!raw || typeof raw !== 'object') return ''
    const item = raw as { text?: unknown; props?: { title?: unknown; formula?: unknown }; content?: unknown }
    if (typeof item.text === 'string') return item.text
    if (typeof item.props?.title === 'string') return item.props.title
    if (typeof item.props?.formula === 'string') return item.props.formula
    return inlineText(item.content)
  }).join('')
}

const headings = computed(() => {
  const result: { id: string; level: number; text: string }[] = []
  const walk = (items: NoteBlock[]) => {
    for (const block of items) {
      if (block.type === 'heading' || block.type === 'toggleHeading') {
        const level = Number(block.props.level) || 1
        const text = inlineText(block.content).trim()
        if (level <= 4 && text) result.push({ id: block.id, level, text })
      }
      walk(block.children || [])
    }
  }
  walk(props.blocks || [])
  return result
})
const minLevel = computed(() => headings.value.reduce((min, heading) => Math.min(min, heading.level), 4))
const expanded = computed(() => (props.open && props.roomy) || peek.value)

function updateCurrent() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (!props.scroller || !headings.value.length) return
    const top = props.scroller.getBoundingClientRect().top + 96
    let active = headings.value[0]?.id || null
    for (const heading of headings.value) {
      const escaped = typeof CSS.escape === 'function' ? CSS.escape(heading.id) : heading.id
      const element = props.scroller.querySelector(`[data-block-id="${escaped}"], [data-note-opaque="${escaped}"]`)
      if (!element) continue
      if (element.getBoundingClientRect().top <= top) active = heading.id
      else break
    }
    current.value = active
  })
}
watch(() => [props.scroller, headings.value], () => {
  observedScroller?.removeEventListener('scroll', updateCurrent)
  observedScroller = props.scroller
  observedScroller?.addEventListener('scroll', updateCurrent, { passive: true })
  updateCurrent()
}, { deep: true, immediate: true })
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observedScroller?.removeEventListener('scroll', updateCurrent)
})
</script>

<template>
  <div v-if="headings.length" class="dt-note-outline-anchor">
    <nav
      class="dt-note-outline"
      :data-expanded="expanded || undefined"
      :data-pinned="(open && roomy) || undefined"
      aria-label="本页内容"
      @pointerenter="!open || !roomy ? peek = true : undefined"
      @pointerleave="peek = false"
    >
      <div class="dt-note-outline-head">
        <span>本页内容</span>
        <button
          v-if="roomy"
          class="dt-note-icon-button"
          :aria-label="open ? '折叠大纲' : '固定展开大纲'"
          :aria-pressed="open"
          :title="open ? '折叠大纲' : '固定展开大纲'"
          @click="peek = false; emit('toggle')"
        >
          <LegacyIcon :name="open ? 'panelLeftClose' : 'tableOfContents'" :size="14" />
        </button>
      </div>
      <ol>
        <li v-for="heading in headings" :key="heading.id" :data-level="heading.level - minLevel + 1">
          <button :aria-current="heading.id === current ? 'location' : undefined" @click="peek = false; emit('jump', heading.id)">
            <span class="dt-note-outline-mark" aria-hidden="true" />
            <span class="dt-note-outline-text">{{ heading.text }}</span>
          </button>
        </li>
      </ol>
    </nav>
  </div>
</template>
