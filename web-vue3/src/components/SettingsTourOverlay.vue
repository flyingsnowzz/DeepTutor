<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LegacyIcon from './LegacyIcon.vue'
import { nextTourIndex, previousTourIndex, tourStepAt } from '../settingsTour'

const props = defineProps<{ stepIndex: number }>()
const emit = defineEmits<{ close: []; 'update:stepIndex': [index: number] }>()
const route = useRoute()
const router = useRouter()
const rect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
let retryTimer: ReturnType<typeof setTimeout> | undefined
let frame = 0
let attempts = 0

const step = computed(() => tourStepAt(props.stepIndex))
const last = computed(() => props.stepIndex >= 0 && props.stepIndex === 6)
const hole = computed(() => {
  if (!rect.value) return null
  return {
    left: rect.value.left - 10,
    top: rect.value.top - 10,
    width: rect.value.width + 20,
    height: rect.value.height + 20,
  }
})
const tooltip = computed(() => {
  if (!hole.value || typeof window === 'undefined') return { top: 16, left: 16 }
  const below = hole.value.top + hole.value.height + 16
  const estimatedHeight = 205
  const top = below + estimatedHeight > window.innerHeight - 16
    ? Math.max(16, hole.value.top - estimatedHeight - 16)
    : Math.min(below, window.innerHeight - estimatedHeight - 16)
  return {
    top,
    left: Math.max(16, Math.min(hole.value.left, window.innerWidth - 356)),
  }
})

function clearRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  if (frame) cancelAnimationFrame(frame)
  retryTimer = undefined
  frame = 0
}

function measure() {
  const current = step.value
  if (!current) return
  const element =
    document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`) ||
    (current.target === 'tour-page-heading'
      ? document.querySelector<HTMLElement>('.legacy-settings-container h1')
      : null)
  if (!element) {
    attempts += 1
    if (attempts < 8) retryTimer = setTimeout(measure, 80)
    return
  }
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  frame = requestAnimationFrame(() => {
    const bounds = element.getBoundingClientRect()
    rect.value = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
  })
}

function begin() {
  clearRetry()
  attempts = 0
  rect.value = null
  const current = step.value
  if (!current) return
  if (!route.path.startsWith(current.route)) {
    void router.push(current.route)
    return
  }
  void nextTick(measure)
}

watch([() => props.stepIndex, () => route.path], begin, { immediate: true })

function onKeydown(event: KeyboardEvent) {
  if (!step.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
    event.preventDefault()
    advance()
  } else if (event.key === 'ArrowLeft' && props.stepIndex > 0) {
    event.preventDefault()
    emit('update:stepIndex', previousTourIndex(props.stepIndex))
  }
}
watch(() => props.stepIndex, index => {
  if (index < 0) rect.value = null
})
function advance() {
  if (last.value) emit('close')
  else emit('update:stepIndex', nextTourIndex(props.stepIndex))
}
function back() {
  emit('update:stepIndex', previousTourIndex(props.stepIndex))
}
function onResize() { measure() }
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  clearRetry()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div v-if="step && hole" class="settings-tour" aria-live="polite">
    <div class="settings-tour-scrim" />
    <div class="settings-tour-highlight" :style="{ left: `${hole.left}px`, top: `${hole.top}px`, width: `${hole.width}px`, height: `${hole.height}px` }" />
    <section class="settings-tour-tooltip" role="dialog" aria-modal="false" aria-labelledby="settings-tour-title" :style="{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }">
      <div class="settings-tour-progress"><i :style="{ width: `${((stepIndex + 1) / 7) * 100}%` }" /></div>
      <header><span><LegacyIcon name="sparkles" :size="13" />第 {{ stepIndex + 1 }} / 7 步</span><button type="button" aria-label="跳过设置引导" @click="emit('close')"><LegacyIcon name="close" :size="14" /></button></header>
      <h2 id="settings-tour-title">{{ step.title }}</h2>
      <p>{{ step.description }}</p>
      <footer><button type="button" :disabled="stepIndex === 0" @click="back"><LegacyIcon name="chevronLeft" :size="13" />上一步</button><button type="button" class="settings-tour-skip" @click="emit('close')">跳过引导</button><button type="button" class="primary" @click="advance">{{ last ? '完成' : '下一步' }}<LegacyIcon name="chevronRight" :size="13" /></button></footer>
    </section>
  </div>
</template>
