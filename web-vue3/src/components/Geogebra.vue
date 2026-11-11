<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { parseGgbCommands, runGeoGebraCommand, type GeoGebraCommandAPI } from '../geogebraCommands'

export interface GeogebraPayload {
  app_name?: string
  commands: string[]
  show_axes?: boolean
  show_grid?: boolean
  view?: { x_min: number; x_max: number; y_min: number; y_max: number }
}

const props = withDefaults(
  defineProps<{
    script?: string
    editable?: boolean
    payload?: GeogebraPayload
    title?: string
    width?: number
    height?: number
    perspective?: string
  }>(),
  { script: '', editable: false, width: 760, height: 480 },
)

const containerRef = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const commandErrors = ref<string[]>([])

const GGB_SCRIPT_SRC = 'https://www.geogebra.org/apps/deployggb.js'
let ggbLoader: Promise<void> | null = null

function loadGgbScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window unavailable'))
  const w = window as unknown as { GGBApplet?: new (p: Record<string, unknown>, html5: boolean) => { inject: (id: string) => void } }
  if (w.GGBApplet) return Promise.resolve()
  if (ggbLoader) return ggbLoader
  ggbLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GGB_SCRIPT_SRC}"]`)
    if (existing) {
      if (w.GGBApplet) return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => {
        ggbLoader = null
        reject(new Error('GeoGebra script failed to load'))
      })
      return
    }
    const script = document.createElement('script')
    script.src = GGB_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      ggbLoader = null
      reject(new Error('GeoGebra script failed to load'))
    }
    document.head.appendChild(script)
  })
  return ggbLoader
}

let containerCounter = 0
const containerId = `ggb-${++containerCounter}-${Date.now().toString(36)}`
let cancelled = false

onMounted(async () => {
  cancelled = false
  loading.value = true
  try {
    await loadGgbScript()
    if (cancelled) return
    const w = window as unknown as {
      GGBApplet?: new (p: Record<string, unknown>, html5: boolean) => { inject: (id: string) => void }
    }
    if (!w.GGBApplet) throw new Error('GGBApplet global missing after script load')
    const commands = props.payload?.commands?.length
      ? props.payload.commands.map(String).filter(c => c.trim())
      : parseGgbCommands(props.script)
    const container = containerRef.value
    if (!container) return
    container.id = containerId
    container.innerHTML = ''

    const applet = new w.GGBApplet(
      {
        appName: props.payload?.app_name || 'geometry',
        width: props.width,
        height: props.height,
        perspective: props.perspective,
        preventFocus: true,
        showToolBar: props.editable,
        showAlgebraInput: props.editable,
        showMenuBar: false,
        showResetIcon: !props.editable,
        enableLabelDrags: props.editable,
        enableShiftDragZoom: true,
        useBrowserForJS: false,
        appletOnLoad: (api: GeoGebraCommandAPI & {
          setAxesVisible?: (x: boolean, y: boolean) => void
          setGridVisible?: (v: boolean) => void
          setCoordSystem?: (xMin: number, xMax: number, yMin: number, yMax: number) => void
        }) => {
          if (cancelled) return
          if (props.payload?.show_axes !== undefined)
            api.setAxesVisible?.(props.payload.show_axes, props.payload.show_axes)
          if (props.payload?.show_grid !== undefined) api.setGridVisible?.(props.payload.show_grid)
          const view = props.payload?.view
          if (view && api.setCoordSystem)
            api.setCoordSystem(view.x_min, view.x_max, view.y_min, view.y_max)
          const failures: string[] = []
          for (const cmd of commands) {
            try {
              if (!runGeoGebraCommand(api, cmd)) failures.push(cmd)
            } catch {
              failures.push(cmd)
            }
          }
          loading.value = false
          if (!cancelled && failures.length) commandErrors.value = failures
        },
      },
      true,
    )
    applet.inject(containerId)
  } catch (err) {
    if (!cancelled) {
      error.value = err instanceof Error ? err.message : String(err)
      loading.value = false
    }
  }
})

onBeforeUnmount(() => {
  cancelled = true
  if (containerRef.value) containerRef.value.innerHTML = ''
})
</script>

<template>
  <div class="my-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
    <div v-if="title" class="border-b border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)]">
      {{ title }}
    </div>
    <div v-if="error" class="p-4 text-sm text-[var(--destructive,#dc2626)]">
      无法加载 GeoGebra：{{ error }}
    </div>
    <template v-else>
      <div
        v-if="commandErrors.length"
        role="alert"
        class="border-b border-[var(--border)] px-3 py-2 text-[12px] leading-relaxed text-[var(--destructive,#dc2626)]"
      >
        <span class="font-medium">GeoGebra 拒绝了 {{ commandErrors.length }} 条命令：</span>
        <ul class="mt-1 list-inside list-disc">
          <li v-for="cmd in commandErrors" :key="cmd" class="truncate font-mono text-[11px]">{{ cmd }}</li>
        </ul>
      </div>
      <div v-if="loading" class="flex h-24 items-center justify-center text-sm text-[var(--muted-foreground)]">
        正在加载 GeoGebra…
      </div>
      <div ref="containerRef" class="geogebra-host" :style="{ minHeight: `${height}px` }" />
    </template>
  </div>
</template>
