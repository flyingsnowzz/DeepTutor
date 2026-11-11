<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import Geogebra, { type GeogebraPayload } from './Geogebra.vue'
import MermaidBlock from './MermaidBlock.vue'
import MathAnimatorViewer from './MathAnimatorViewer.vue'
import { isManimResult, type VisualizeCanvasResult, type VisualizeResult } from '../visualizeResult'
import {
  parseChartConfig,
  prepareIframeHtml,
  sanitizeSvg,
  splitSvgBlocks,
} from '../visualizeRendering'

const props = defineProps<{ result: VisualizeResult }>()
const showCode = ref(false)
const copied = ref(false)
const fullscreen = ref(false)
const chartError = ref<string | null>(null)
const chartCanvas = ref<HTMLCanvasElement | null>(null)
const fullscreenChartCanvas = ref<HTMLCanvasElement | null>(null)
const htmlFrame = ref<HTMLIFrameElement | null>(null)
const pluginFrame = ref<HTMLIFrameElement | null>(null)
const htmlHeight = ref(560)
const pluginHeight = ref(560)
let chart: { destroy: () => void } | null = null
let fullscreenChart: { destroy: () => void } | null = null

const isManim = computed(() => isManimResult(props.result))
const manimResult = computed(() => (isManimResult(props.result) ? props.result.manim : null))
const canvasResult = computed<VisualizeCanvasResult | null>(() =>
  isManim.value ? null : (props.result as VisualizeCanvasResult),
)
const rendererName = computed(() =>
  canvasResult.value
    ? canvasResult.value.renderer.native_renderer || canvasResult.value.render_type
    : '',
)
const safeSvgBlocks = computed(() => {
  if (rendererName.value !== 'svg' || !canvasResult.value) return []
  return splitSvgBlocks(canvasResult.value.code.content.trim())
    .map(sanitizeSvg)
    .filter(Boolean)
})
const preparedHtml = computed(() =>
  rendererName.value === 'html' && canvasResult.value
    ? prepareIframeHtml(canvasResult.value.code.content)
    : '',
)
const label = computed(() => {
  const result = canvasResult.value
  if (!result) return ''
  if (rendererName.value === 'chartjs') {
    return `Chart.js · ${result.analysis.chart_type || 'chart'}`
  }
  if (rendererName.value === 'mermaid') {
    return `Mermaid · ${result.analysis.chart_type || 'diagram'}`
  }
  return result.presentation.title ? `${result.renderer.id} · ${result.presentation.title}` : result.renderer.id
})
const geogebraPayload = computed<GeogebraPayload | undefined>(() => {
  if (rendererName.value !== 'geogebra' || !canvasResult.value) return undefined
  const raw = canvasResult.value.payload.data
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { commands?: unknown }).commands)) {
    return undefined
  }
  const data = raw as Partial<GeogebraPayload> & { commands: unknown[] }
  return {
    app_name: data.app_name,
    commands: data.commands.map(String).filter(command => command.trim()),
    show_axes: data.show_axes,
    show_grid: data.show_grid,
    view: data.view,
  }
})

async function renderChart() {
  if (rendererName.value !== 'chartjs' || !chartCanvas.value || !canvasResult.value) return
  try {
    const ChartModule = await import('chart.js/auto')
    chart?.destroy()
    chart = new ChartModule.default(
      chartCanvas.value,
      parseChartConfig(canvasResult.value.code.content) as ConstructorParameters<typeof ChartModule.default>[1],
    )
    chartError.value = null
  } catch (cause) {
    chartError.value = cause instanceof Error ? cause.message : '图表渲染失败'
  }
}

async function renderFullscreenChart() {
  if (rendererName.value !== 'chartjs' || !fullscreenChartCanvas.value || !canvasResult.value) return
  try {
    const ChartModule = await import('chart.js/auto')
    fullscreenChart?.destroy()
    fullscreenChart = new ChartModule.default(
      fullscreenChartCanvas.value,
      parseChartConfig(canvasResult.value.code.content) as ConstructorParameters<typeof ChartModule.default>[1],
    )
  } catch {
    /* The regular renderer already surfaces the parse/render error. */
  }
}

function onFrameMessage(event: MessageEvent) {
  if (event.source !== htmlFrame.value?.contentWindow && event.source !== pluginFrame.value?.contentWindow) return
  const data = event.data as { type?: string; text?: string; height?: number } | undefined
  if (!data || typeof data !== 'object') return
  if (
    (data.type === 'dt:visualize-prompt' || data.type === 'deeptutor:visualization:prompt') &&
    data.text
  ) {
    window.dispatchEvent(new CustomEvent('dt:visualize-prompt', { detail: data.text }))
  }
  if (
    (data.type === 'dt:visualize-height' || data.type === 'deeptutor:visualization:resize') &&
    typeof data.height === 'number' &&
    Number.isFinite(data.height)
  ) {
    const next = Math.min(2400, Math.max(240, Math.ceil(data.height) + 8))
    if (event.source === htmlFrame.value?.contentWindow) htmlHeight.value = next
    else pluginHeight.value = next
  }
}

function onSvgClick(event: MouseEvent) {
  const target = (event.target as Element | null)?.closest?.('[data-prompt]')
  const prompt = target?.getAttribute('data-prompt')?.trim()
  if (prompt) window.dispatchEvent(new CustomEvent('dt:visualize-prompt', { detail: prompt }))
}

function postPluginPayload() {
  const result = canvasResult.value
  if (!pluginFrame.value || !result) return
  pluginFrame.value.contentWindow?.postMessage(
    {
      type: 'deeptutor:visualization:render',
      schema_version: result.schema_version,
      renderer: result.renderer,
      payload: result.payload,
      presentation: result.presentation,
      interaction: result.interaction,
    },
    '*',
  )
}

async function copyCode() {
  if (!canvasResult.value) return
  try {
    await navigator.clipboard.writeText(canvasResult.value.code.content)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    /* Clipboard can be unavailable in restricted browsers. */
  }
}

function openHtmlInNewTab() {
  if (!preparedHtml.value) return
  try {
    const contentUrl = URL.createObjectURL(new Blob([preparedHtml.value], { type: 'text/html' }))
    const wrapper = `<!doctype html><html><head><meta charset="utf-8"><title>可视化</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style></head><body><iframe sandbox="allow-scripts" src="${contentUrl}"></iframe></body></html>`
    const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/html' }))
    window.open(url, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
      URL.revokeObjectURL(contentUrl)
    }, 60_000)
  } catch {
    /* Popups/object URLs may be unavailable. */
  }
}

function closeFullscreenOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') fullscreen.value = false
}

watch(
  () => [rendererName.value, canvasResult.value?.code.content] as const,
  () => {
    chartError.value = null
    void renderChart()
  },
  { immediate: true },
)
watch(
  () => props.result,
  () => {
    showCode.value = false
    fullscreen.value = false
  },
  { deep: true },
)
watch(fullscreen, open => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) document.addEventListener('keydown', closeFullscreenOnEscape)
  else document.removeEventListener('keydown', closeFullscreenOnEscape)
  if (open && rendererName.value === 'chartjs') {
    void nextTick(renderFullscreenChart)
  } else {
    fullscreenChart?.destroy()
    fullscreenChart = null
  }
})

onMounted(() => {
  window.addEventListener('message', onFrameMessage)
  void renderChart()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onFrameMessage)
  document.removeEventListener('keydown', closeFullscreenOnEscape)
  chart?.destroy()
  chart = null
  fullscreenChart?.destroy()
  fullscreenChart = null
  document.body.style.overflow = ''
})
</script>

<template>
  <MathAnimatorViewer v-if="isManim && manimResult" :result="manimResult" />
  <div v-else-if="canvasResult" class="visualization-viewer">
    <div class="visualization-canvas" :class="{ 'is-html': rendererName === 'html' || canvasResult.renderer.target === 'iframe' }">
      <button
        v-if="rendererName !== 'html' && canvasResult.renderer.target !== 'iframe'"
        type="button"
        class="visualization-fullscreen-button"
        @click="fullscreen = true"
      >
        <LegacyIcon name="maximize2" :size="10" :stroke-width="1.8" />全屏
      </button>

      <template v-if="rendererName === 'svg'">
        <div
          v-for="(block, index) in safeSvgBlocks"
          :key="index"
          class="visualization-svg-root"
          v-html="block"
          @click="onSvgClick"
        />
        <div v-if="!safeSvgBlocks.length" class="visualization-error">
          <strong>SVG 渲染错误</strong>
          <pre>SVG 无法安全渲染，或内容不是以 &lt;svg&gt; 开头。</pre>
        </div>
      </template>

      <MermaidBlock
        v-else-if="rendererName === 'mermaid'"
        :code="canvasResult.code.content"
        :language="canvasResult.code.language"
      />

      <div v-else-if="rendererName === 'html'" class="visualization-html-wrap">
        <button type="button" class="visualization-open-button" @click="openHtmlInNewTab">
          <LegacyIcon name="cornerUpRight" :size="10" :stroke-width="1.8" />新标签页打开
        </button>
        <iframe
          ref="htmlFrame"
          title="HTML 可视化"
          sandbox="allow-scripts"
          :srcdoc="preparedHtml"
          :style="{ height: `${htmlHeight}px` }"
        />
      </div>

      <div v-else-if="rendererName === 'chartjs'">
        <div v-if="chartError" class="visualization-error">
          <strong>图表渲染错误</strong>
          <pre>{{ chartError }}</pre>
        </div>
        <div v-else class="visualization-chart-wrap">
          <canvas ref="chartCanvas" />
        </div>
      </div>

      <Geogebra
        v-else-if="rendererName === 'geogebra'"
        :payload="geogebraPayload"
        :script="geogebraPayload ? '' : canvasResult.code.content"
        :title="canvasResult.presentation.title"
      />

      <iframe
        v-else-if="canvasResult.renderer.target === 'iframe'"
        ref="pluginFrame"
        :src="canvasResult.renderer.entry_url"
        :title="canvasResult.presentation.title || canvasResult.renderer.id"
        sandbox="allow-scripts"
        :style="{ height: `${pluginHeight}px` }"
        @load="postPluginPayload"
      />

      <div v-else class="visualization-error">
        没有注册渲染器：{{ rendererName || canvasResult.render_type }}
      </div>
    </div>

    <div class="visualization-toolbar">
      <button type="button" @click="showCode = !showCode">
        <LegacyIcon name="fileText" :size="12" :stroke-width="1.8" />{{ showCode ? '隐藏代码' : '显示代码' }}
      </button>
      <button type="button" @click="copyCode">
        <LegacyIcon :name="copied ? 'check' : 'copy'" :size="12" :stroke-width="1.8" />
        {{ copied ? '已复制' : '复制代码' }}
      </button>
      <span class="visualization-label">{{ label }}</span>
    </div>

    <div v-if="showCode" class="visualization-code">
      <div class="visualization-code-lang">{{ canvasResult.code.language }}</div>
      <pre><code>{{ canvasResult.code.content }}</code></pre>
    </div>
    <p v-if="canvasResult.review.changed && canvasResult.review.review_notes" class="visualization-review">
      审查：{{ canvasResult.review.review_notes }}
    </p>

    <Teleport to="body">
      <div v-if="fullscreen" class="visualization-fullscreen" @click.self="fullscreen = false">
        <div class="visualization-fullscreen-head">
          <span>{{ label }}</span>
          <button type="button" @click.stop="fullscreen = false">
            <LegacyIcon name="close" :size="12" :stroke-width="1.8" />关闭
          </button>
        </div>
        <div class="visualization-fullscreen-body">
          <template v-if="rendererName === 'svg'">
            <div
              v-for="(block, index) in safeSvgBlocks"
              :key="index"
              class="visualization-svg-root"
              v-html="block"
              @click="onSvgClick"
            />
          </template>
          <MermaidBlock
            v-else-if="rendererName === 'mermaid'"
            :code="canvasResult.code.content"
            :language="canvasResult.code.language"
          />
          <div v-else-if="rendererName === 'chartjs'" class="visualization-chart-wrap">
            <canvas ref="fullscreenChartCanvas" />
          </div>
          <Geogebra
            v-else-if="rendererName === 'geogebra'"
            :payload="geogebraPayload"
            :script="geogebraPayload ? '' : canvasResult.code.content"
            :title="canvasResult.presentation.title"
          />
          <div v-else class="visualization-fullscreen-hint">该渲染器请使用页面内的预览。</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
