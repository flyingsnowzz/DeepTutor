export type VisualizeRenderMode = 'auto' | (string & {})
export type VisualizeQuality = 'low' | 'medium' | 'high'

export interface VisualizeFormConfig {
  render_mode: VisualizeRenderMode
  quality: VisualizeQuality
  style_hint: string
}

export interface VisualizerCatalogItem {
  id: string
  version: string
  display_name: string
  description: string
  render_target: 'native' | 'iframe' | 'artifact'
  native_renderer: string
  origin: 'core' | 'bundled' | 'user'
  installed: boolean
  enabled: boolean
  uninstallable: boolean
  agentic: boolean
}

export const DEFAULT_VISUALIZE_CONFIG: VisualizeFormConfig = {
  render_mode: 'auto',
  quality: 'medium',
  style_hint: '',
}

export const VISUALIZE_RENDER_LABELS: Record<string, string> = {
  auto: '自动',
  chartjs: 'Chart.js',
  svg: 'SVG',
  mermaid: 'Mermaid',
  mindmap: '思维导图',
  html: 'HTML',
  geogebra: 'GeoGebra',
  manim_video: '数学动画',
  manim_image: '动画分镜',
}

export function isManimRenderMode(renderMode: string): boolean {
  return renderMode === 'manim_video' || renderMode === 'manim_image'
}

export function buildVisualizeWSConfig(config: VisualizeFormConfig): Record<string, unknown> {
  return {
    render_mode: config.render_mode,
    quality: config.quality,
    style_hint: config.style_hint.trim(),
  }
}

export function summarizeVisualizeConfig(config: VisualizeFormConfig): string {
  const label = VISUALIZE_RENDER_LABELS[config.render_mode] ?? config.render_mode
  if (!isManimRenderMode(config.render_mode)) return label
  const quality = { low: '低', medium: '中', high: '高' }[config.quality]
  return `${label} · ${quality}`
}
