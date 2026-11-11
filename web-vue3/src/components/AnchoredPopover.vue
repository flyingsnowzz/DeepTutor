<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface PopoverAnchor { top: number; left: number; right: number; bottom: number }
const props = withDefaults(defineProps<{ anchor: PopoverAnchor; width?: number; label: string }>(), { width: 350 })
const emit = defineEmits<{ close: [] }>()
const popover = ref<HTMLElement | null>(null)
const position = ref({ top: '110px', left: '280px', width: '350px', visibility: 'hidden' as 'hidden' | 'visible' })
let dismissTimer: ReturnType<typeof setTimeout> | undefined

async function place() {
  await nextTick()
  const node = popover.value
  if (!node) return
  const gap = 8
  const margin = 12
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(props.width, viewportWidth - margin * 2)
  const height = node.offsetHeight
  let left = props.anchor.right + gap
  if (left + width > viewportWidth - margin) left = props.anchor.left - gap - width
  if (left < margin) left = Math.min(Math.max(margin, props.anchor.left), viewportWidth - width - margin)
  let top = props.anchor.top
  if (top + height > viewportHeight - margin) top = viewportHeight - margin - height
  position.value = { top: `${Math.max(margin, top)}px`, left: `${left}px`, width: `${width}px`, visibility: 'visible' }
}
function onPointerDown(event: PointerEvent) {
  const target = event.target as Element | null
  if (popover.value?.contains(target)) return
  if (target?.closest('[role="dialog"], [role="menu"], [data-calendar-keep-popover]')) return
  emit('close')
}
function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented) {
    event.stopPropagation()
    emit('close')
  }
}
watch(() => props.anchor, place, { deep: true })
watch(() => props.width, place)
onMounted(() => {
  void place()
  dismissTimer = setTimeout(() => document.addEventListener('pointerdown', onPointerDown), 0)
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  if (dismissTimer) clearTimeout(dismissTimer)
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <Teleport to="body">
    <div ref="popover" role="dialog" :aria-label="label" class="calendar-popover" :style="position" data-calendar-popover>
      <slot />
    </div>
  </Teleport>
</template>
