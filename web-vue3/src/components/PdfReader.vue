<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import AnnotationLayer from './AnnotationLayer.vue'
import AnnotationPopover from './AnnotationPopover.vue'
import {
  annotationsForLocator,
  saveAnnotation,
  type AnnotationDraft,
  type AnnotationItem,
  type NormalisedRect,
} from '../readingAnnotations'
import { cleanQuote, elementBox, normaliseRects, rangeClientRects } from '../readingSelection'

pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'

const props = withDefaults(defineProps<{
  url: string
  targetLocator?: number
  materialId?: string
  annotations?: AnnotationItem[]
  activeAnnotationId?: string | null
}>(), { targetLocator: 1, materialId: '', annotations: () => [], activeAnnotationId: null })
const emit = defineEmits<{
  select: [selection: { text: string; locator: number; rects: NormalisedRect[] }]
  'annotations-change': [annotations: AnnotationItem[]]
  'annotation-select': [annotation: AnnotationItem]
}>()
const canvas = ref<HTMLCanvasElement | null>(null)
const textContainer = ref<HTMLDivElement | null>(null)
const pageBox = ref<HTMLElement | null>(null)
const pageNumber = ref(1)
const pageCount = ref(0)
const scale = ref(1.1)
const loading = ref(true)
const error = ref('')
let document: pdfjs.PDFDocumentProxy | null = null
let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null
let renderTask: pdfjs.RenderTask | null = null
let loadGeneration = 0
let renderGeneration = 0
const localAnnotations = ref<AnnotationItem[]>([...props.annotations])
const draft = ref<{ text: string; locator: number; rects: NormalisedRect[] } | null>(null)
const annotationError = ref('')
const pageAnnotations = computed(() => annotationsForLocator(localAnnotations.value, pageNumber.value))
async function loadDocument() {
  const version = ++loadGeneration
  loading.value = true
  error.value = ''
  try {
    loadingTask?.destroy()
    loadingTask = pdfjs.getDocument({ url: props.url })
    document = await loadingTask.promise
    if (version !== loadGeneration) return
    pageCount.value = document.numPages
    pageNumber.value = Math.min(pageNumber.value, pageCount.value)
    await renderPage()
  } catch (cause) { if (version === loadGeneration) error.value = cause instanceof Error ? cause.message : 'PDF 加载失败' }
  finally { if (version === loadGeneration) loading.value = false }
}
async function renderPage() {
  if (!document || !canvas.value || !textContainer.value) return
  const version = ++renderGeneration
  renderTask?.cancel()
  await nextTick()
  try {
    const page = await document.getPage(pageNumber.value)
    const viewport = page.getViewport({ scale: scale.value })
    const target = canvas.value
    target.width = Math.floor(viewport.width)
    target.height = Math.floor(viewport.height)
    textContainer.value.style.width = `${Math.floor(viewport.width)}px`
    textContainer.value.style.height = `${Math.floor(viewport.height)}px`
    const context = target.getContext('2d')
    if (!context) throw new Error('无法创建 PDF 画布')
    renderTask = page.render({ canvas: target, canvasContext: context, viewport })
    await renderTask.promise
    if (version !== renderGeneration) return
    textContainer.value.replaceChildren()
    const textContent = await page.getTextContent()
    const layer = new pdfjs.TextLayer({ textContentSource: textContent, container: textContainer.value, viewport })
    await layer.render()
  } catch (cause) { if (version === renderGeneration && !(cause instanceof pdfjs.RenderingCancelledException)) error.value = cause instanceof Error ? cause.message : 'PDF 渲染失败' }
}
watch(() => props.url, loadDocument, { immediate: true })
watch([pageNumber, scale], renderPage)
watch(() => props.targetLocator, value => { if (Number.isInteger(value) && value > 0 && value !== pageNumber.value) pageNumber.value = value })
watch(() => props.annotations, value => { localAnnotations.value = [...value] }, { deep: true })
onBeforeUnmount(() => { loadGeneration++; renderGeneration++; renderTask?.cancel(); document = null; void loadingTask?.destroy() })
function selectText() {
  const selection = window.getSelection()
  const text = cleanQuote(selection?.toString() || '')
  if (!text || !selection?.rangeCount || !pageBox.value) return
  const range = selection.getRangeAt(0)
  const rects = normaliseRects(rangeClientRects(range), elementBox(pageBox.value))
  emit('select', { text, locator: pageNumber.value, rects })
  if (props.materialId) draft.value = { text, locator: pageNumber.value, rects }
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
  if (!props.materialId) return
  annotationError.value = ''
  try {
    const saved = await saveAnnotation(props.materialId, value)
    localAnnotations.value = [
      ...localAnnotations.value.filter(item => item.annotation_id !== saved.annotation_id),
      saved,
    ]
    emit('annotations-change', localAnnotations.value)
    draft.value = null
  } catch (cause) {
    annotationError.value = cause instanceof Error ? cause.message : '批注保存失败'
  }
}
</script>

<template>
  <section class="pdf-reader" @mouseup="selectText">
    <header class="pdf-toolbar"><button :disabled="pageNumber <= 1" @click="pageNumber--">上一页</button><span>第 {{ pageNumber }} / {{ pageCount || '—' }} 页</span><button :disabled="pageNumber >= pageCount" @click="pageNumber++">下一页</button><button @click="scale = Math.max(0.5, scale - 0.1)">缩小</button><button @click="scale = Math.min(3, scale + 0.1)">放大</button></header><p v-if="loading" role="status">正在加载 PDF…</p><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="annotationError" class="error" role="alert">{{ annotationError }}</p>
    <div ref="pageBox" class="pdf-page">
      <canvas ref="canvas" />
      <div ref="textContainer" class="pdf-text-layer" />
      <AnnotationLayer :annotations="pageAnnotations" :highlighted-annotation-id="activeAnnotationId" @select="emit('annotation-select', $event)" />
      <AnnotationPopover
        v-if="draft"
        :locator="draft.locator"
        :quote="draft.text"
        :rects="draft.rects"
        @save="saveDraft"
        @cancel="draft = null"
      />
    </div>
  </section>
</template>
