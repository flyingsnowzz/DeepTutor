<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AnnotationPopover from './AnnotationPopover.vue'
import LegacyIcon from './LegacyIcon.vue'
import { scopedUrl } from '../workspaceScope'
import {
  saveAnnotation,
  type AnnotationDraft,
  type AnnotationItem,
  type NormalisedRect,
} from '../readingAnnotations'
import { cleanQuote } from '../readingSelection'
import type { ReaderDisplayPreferences } from '../readingDisplay'

const props = withDefaults(defineProps<{
  url: string
  targetLocator?: number
  targetHref?: string
  materialId?: string
  annotations?: AnnotationItem[]
  activeAnnotationId?: string | null
  preferences?: ReaderDisplayPreferences
}>(), {
  targetLocator: 1,
  targetHref: '',
  materialId: '',
  annotations: () => [],
  activeAnnotationId: null,
  preferences: () => ({
    fontSize: 17,
    lineWidth: 84,
    serif: true,
    readerTheme: 'auto',
    spreadMode: 'none',
  }),
})
const emit = defineEmits<{
  'annotations-change': [annotations: AnnotationItem[]]
  'annotation-select': [annotation: AnnotationItem]
  'location-change': [locator: number, sourceAnchor: string, percentage: number]
}>()

const mount = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref('')
const annotationError = ref('')
const localAnnotations = ref<AnnotationItem[]>([...props.annotations])
const draft = ref<{ text: string; locator: number; anchor: string; rects: NormalisedRect[] } | null>(null)
const currentLocator = ref(props.targetLocator)
const currentCfi = ref('')
const percentage = ref(0)
let book: any = null
let rendition: any = null
let generation = 0

function applyDisplay() {
  if (!rendition) return
  const preferences = props.preferences
  const theme =
    preferences.readerTheme === 'sepia'
      ? { background: '#f4ecd8', color: '#473c2c' }
      : preferences.readerTheme === 'night'
        ? { background: '#16181d', color: '#e8e5df' }
        : { background: '#ffffff', color: '#222222' }
  rendition.themes.registerCss('deeptutor-reader', `
    html, body { background: ${theme.background} !important; color: ${theme.color} !important; }
    body {
      font-family: ${preferences.serif ? "ui-serif, Georgia, 'PingFang SC', serif" : "ui-sans-serif, system-ui, 'PingFang SC', sans-serif"} !important;
      font-size: ${preferences.fontSize}px !important;
      line-height: 1.75 !important;
      max-width: ${preferences.lineWidth}ch !important;
      margin: 0 auto !important;
      padding: 24px !important;
    }
    ::selection { background: rgba(23, 106, 91, .25); }
  `)
  rendition.themes.select('deeptutor-reader')
  rendition.spread(preferences.spreadMode)
}

function locatorForHref(href: string | undefined): number {
  if (!href || !book) return currentLocator.value
  const item = book.spine.get(href)
  return Number(item?.index ?? 0) + 1
}

function applyAnnotations() {
  if (!rendition || !book) return
  for (const annotation of localAnnotations.value) {
    let anchor = annotation.source_anchor
    if (!anchor && annotation.quote) {
      const section = book.spine.get(Math.max(0, annotation.locator - 1))
      const found = section?.find?.(annotation.quote)?.[0]?.cfi
      if (found) anchor = found
    }
    if (!anchor) continue
    try {
      rendition.annotations.highlight(
        anchor,
        { annotationId: annotation.annotation_id },
        () => emit('annotation-select', annotation),
        `epub-annotation-${annotation.annotation_id}`,
        annotation.kind === 'underline'
          ? { 'border-bottom': '2px solid rgba(160,120,20,.8)' }
          : { fill: `rgba(250, 220, 90, .45)`, 'fill-opacity': '0.45' },
      )
    } catch {
      /* A stale CFI should not block the rest of the book from rendering. */
    }
  }
}

async function loadBook() {
  const version = ++generation
  loading.value = true
  error.value = ''
  try {
    rendition?.destroy()
    book?.destroy()
    rendition = null
    book = null
    const response = await fetch(scopedUrl(props.url), { credentials: 'include' })
    if (!response.ok) throw new Error(`EPUB 加载失败 (${response.status})`)
    const data = await response.arrayBuffer()
    const { default: ePub } = await import('epubjs')
    book = ePub(data)
    await book.ready
    if (version !== generation || !mount.value) return
    rendition = book.renderTo(mount.value, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: props.preferences.spreadMode,
    })
    applyDisplay()
    rendition.on('relocated', (location: any) => {
      const href = location?.start?.href
      const cfi = String(location?.start?.cfi ?? '')
      currentLocator.value = locatorForHref(href)
      currentCfi.value = cfi
      percentage.value = Number(location?.start?.percentage ?? 0)
      emit('location-change', currentLocator.value, cfi, percentage.value)
      applyAnnotations()
    })
    rendition.hooks.content.register((contents: any) => {
      const document = contents.document as Document
      document.addEventListener('mouseup', () => {
        const selection = contents.window.getSelection?.() as Selection | null
        const text = cleanQuote(selection?.toString() || '')
        if (!text || !selection?.rangeCount) return
        const range = selection.getRangeAt(0)
        const anchor = String(contents.cfiFromRange?.(range) || '')
        draft.value = { text, locator: currentLocator.value, anchor, rects: [] }
      })
    })
    const target = props.targetHref || book.spine.get(Math.max(0, props.targetLocator - 1))?.href
    await rendition.display(target)
    if (version !== generation) return
    applyAnnotations()
    void book.locations?.generate?.(1600)
  } catch (cause) {
    if (version === generation) error.value = cause instanceof Error ? cause.message : 'EPUB 渲染失败'
  } finally {
    if (version === generation) loading.value = false
  }
}

async function saveDraft(value: {
  annotation_id?: string
  locator: number
  kind: AnnotationDraft['kind']
  color: string
  quote: string
  note: string
  rects: NormalisedRect[]
}) {
  if (!props.materialId || !draft.value) return
  annotationError.value = ''
  try {
    const saved = await saveAnnotation(props.materialId, {
      ...value,
      source_anchor: draft.value.anchor,
    })
    localAnnotations.value = [
      ...localAnnotations.value.filter(item => item.annotation_id !== saved.annotation_id),
      saved,
    ]
    emit('annotations-change', localAnnotations.value)
    draft.value = null
    applyAnnotations()
  } catch (cause) {
    annotationError.value = cause instanceof Error ? cause.message : '批注保存失败'
  }
}

async function nextPage() { await rendition?.next?.(); applyAnnotations() }
async function previousPage() { await rendition?.prev?.(); applyAnnotations() }
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') void nextPage()
  if (event.key === 'ArrowLeft') void previousPage()
}

watch(() => props.url, loadBook, { immediate: true })
watch(() => [props.targetHref, props.targetLocator] as const, () => {
  const target = props.targetHref || book?.spine?.get(Math.max(0, props.targetLocator - 1))?.href
  if (target && rendition) void rendition.display(target).then(applyAnnotations)
})
watch(() => props.preferences, () => {
  applyDisplay()
  void nextTick(applyAnnotations)
}, { deep: true })
watch(() => props.annotations, value => {
  localAnnotations.value = [...value]
  applyAnnotations()
}, { deep: true })
onBeforeUnmount(() => {
  generation++
  rendition?.destroy()
  book?.destroy()
})
</script>

<template>
  <section class="epub-reader" tabindex="0" @keydown="onKeydown">
    <header class="epub-toolbar">
      <button type="button" aria-label="上一页" @click="previousPage"><LegacyIcon name="chevronLeft" :size="15" /></button>
      <span>第 {{ currentLocator }} 节<template v-if="percentage"> · {{ Math.round(percentage * 100) }}%</template></span>
      <button type="button" aria-label="下一页" @click="nextPage"><LegacyIcon name="chevronRight" :size="15" /></button>
    </header>
    <p v-if="loading" class="epub-status" role="status">正在加载 EPUB…</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="annotationError" class="error" role="alert">{{ annotationError }}</p>
    <div ref="mount" class="epub-rendition" />
    <AnnotationPopover
      v-if="draft"
      :locator="draft.locator"
      :quote="draft.text"
      :rects="draft.rects"
      @save="saveDraft"
      @cancel="draft = null"
    />
  </section>
</template>

<style scoped>
.epub-reader{display:flex;flex-direction:column;height:100%;min-height:520px;background:var(--background)}
.epub-toolbar{display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--border);color:var(--muted-foreground);font-size:11px}
.epub-toolbar button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--foreground);cursor:pointer}
.epub-rendition{position:relative;min-height:0;flex:1;padding:4px}
.epub-status{padding:20px;text-align:center;color:var(--muted-foreground);font-size:12px}
</style>
