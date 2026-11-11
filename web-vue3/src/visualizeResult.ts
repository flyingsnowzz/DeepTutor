/**
 * Visualization result extraction — Vue3 port of the geogebra branch in
 * web/components/visualize/VisualizationViewer.tsx + web/lib/visualize-types.ts.
 * The canvas envelope carries render_type / renderer.native_renderer, a
 * payload.data object, a code.content fallback, and a presentation.title.
 */
import type { GeogebraPayload } from './components/Geogebra.vue'
import { extractMathAnimatorResult, type MathAnimatorResult } from './mathAnimator'

export interface VisualizeLike {
  render_type?: unknown
  renderer?: { native_renderer?: unknown }
  payload?: { data?: unknown }
  code?: { content?: unknown }
  presentation?: { title?: unknown }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

/** Effective renderer id, mirroring `renderer.native_renderer || render_type`. */
export function nativeRenderer(meta: VisualizeLike): string {
  const native = meta.renderer?.native_renderer
  return String(native ?? meta.render_type ?? '').trim()
}

export interface GeogebraRender {
  payload?: GeogebraPayload
  script: string
  title: string
}

export type VisualizeManimRenderType = 'manim_video' | 'manim_image'

export function isManimRenderType(renderType: string): renderType is VisualizeManimRenderType {
  return renderType === 'manim_video' || renderType === 'manim_image'
}

export interface VisualizerRendererRef {
  id: string
  version: string
  target: 'native' | 'iframe' | 'artifact'
  native_renderer: string
  entry_url: string
}

export interface VisualizeCanvasResult {
  schema_version: string
  response: string
  render_type: string
  renderer: VisualizerRendererRef
  payload: { format: string; data: unknown }
  presentation: { title: string; description: string; alt_text: string; aspect_ratio: string }
  interaction: { events: string[] }
  fallback: Record<string, unknown>
  code: { language: string; content: string }
  analysis: {
    render_type: string
    description: string
    data_description: string
    chart_type: string
    visual_elements: string[]
    rationale: string
    engine?: string
    requested_type?: string
  }
  review: { optimized_code: string; changed: boolean; review_notes: string }
}

export interface VisualizeManimResult {
  render_type: VisualizeManimRenderType
  manim: MathAnimatorResult
}

export type VisualizeResult = VisualizeCanvasResult | VisualizeManimResult

export function isManimResult(result: VisualizeResult): result is VisualizeManimResult {
  return isManimRenderType(result.render_type) && 'manim' in result
}

function serializePayload(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value ?? '')
  }
}

/** Parse the full canvas/manim visualization envelope. */
export function extractVisualizeResult(
  resultMetadata: Record<string, unknown> | undefined,
): VisualizeResult | null {
  if (!resultMetadata) return null
  const renderType = String(resultMetadata.render_type ?? '').trim()
  if (!renderType) return null
  if (isManimRenderType(renderType)) {
    const manim = extractMathAnimatorResult(resultMetadata)
    return manim ? { render_type: renderType, manim } : null
  }

  const rendererRaw = asRecord(resultMetadata.renderer) ?? {}
  const payloadRaw = asRecord(resultMetadata.payload) ?? {}
  const codeRaw = asRecord(resultMetadata.code) ?? {}
  const analysisRaw = asRecord(resultMetadata.analysis) ?? {}
  const reviewRaw = asRecord(resultMetadata.review) ?? {}
  const presentationRaw = asRecord(resultMetadata.presentation) ?? {}
  const interactionRaw = asRecord(resultMetadata.interaction) ?? {}
  const payloadData = Object.prototype.hasOwnProperty.call(payloadRaw, 'data')
    ? payloadRaw.data
    : codeRaw.content
  const content = serializePayload(payloadData)
  if (!content.trim()) return null

  const inferredRenderer =
    renderType === 'svg' ||
    renderType === 'mermaid' ||
    renderType === 'mindmap' ||
    renderType === 'chartjs' ||
    renderType === 'html' ||
    renderType === 'geogebra'
      ? renderType === 'mindmap'
        ? 'mermaid'
        : renderType
      : ''

  return {
    schema_version: String(resultMetadata.schema_version ?? 'deeptutor.visualization/legacy'),
    response: String(resultMetadata.response ?? ''),
    render_type: renderType,
    renderer: {
      id: String(rendererRaw.id ?? renderType),
      version: String(rendererRaw.version ?? '1.0.0'),
      target:
        rendererRaw.target === 'iframe'
          ? 'iframe'
          : rendererRaw.target === 'artifact'
            ? 'artifact'
            : 'native',
      native_renderer: String(rendererRaw.native_renderer ?? inferredRenderer),
      entry_url: String(rendererRaw.entry_url ?? ''),
    },
    payload: {
      format: String(payloadRaw.format ?? codeRaw.language ?? 'text/plain'),
      data: payloadData,
    },
    presentation: {
      title: String(presentationRaw.title ?? ''),
      description: String(presentationRaw.description ?? analysisRaw.description ?? ''),
      alt_text: String(presentationRaw.alt_text ?? ''),
      aspect_ratio: String(presentationRaw.aspect_ratio ?? ''),
    },
    interaction: {
      events: Array.isArray(interactionRaw.events) ? interactionRaw.events.map(String) : [],
    },
    fallback: asRecord(resultMetadata.fallback) ?? {},
    code: {
      language: String(codeRaw.language ?? 'text'),
      content,
    },
    analysis: {
      render_type: String(analysisRaw.render_type ?? renderType),
      description: String(analysisRaw.description ?? ''),
      data_description: String(analysisRaw.data_description ?? ''),
      chart_type: String(analysisRaw.chart_type ?? ''),
      visual_elements: Array.isArray(analysisRaw.visual_elements)
        ? analysisRaw.visual_elements.map(String)
        : [],
      rationale: String(analysisRaw.rationale ?? ''),
      engine: analysisRaw.engine ? String(analysisRaw.engine) : undefined,
      requested_type: analysisRaw.requested_type ? String(analysisRaw.requested_type) : undefined,
    },
    review: {
      optimized_code: String(reviewRaw.optimized_code ?? ''),
      changed: Boolean(reviewRaw.changed),
      review_notes: String(reviewRaw.review_notes ?? ''),
    },
  }
}

/**
 * Returns Geogebra render inputs for a geogebra visualization, or null when the
 * envelope is another renderer / malformed.
 */
export function extractGeogebraRender(meta: VisualizeLike | undefined): GeogebraRender | null {
  if (!meta) return null
  if (nativeRenderer(meta) !== 'geogebra') return null
  const raw = asRecord(meta.payload?.data)
  const payload =
    raw && Array.isArray(raw.commands)
      ? ({
          app_name: raw.app_name as string | undefined,
          commands: (raw.commands as unknown[]).map(String).filter(c => c.trim()),
          show_axes: raw.show_axes as boolean | undefined,
          show_grid: raw.show_grid as boolean | undefined,
          view: raw.view as GeogebraPayload['view'],
        } satisfies GeogebraPayload)
      : undefined
  const script = payload ? '' : String(meta.code?.content ?? '')
  return { payload, script, title: String(meta.presentation?.title ?? '') }
}
