/**
 * Deep research form model — Vue3 port of web/lib/research-types.ts.
 */
export type ResearchMode = '' | 'notes' | 'report' | 'comparison' | 'learning_path'
export type ResearchDepth = '' | 'quick' | 'standard' | 'deep' | 'manual'

export interface OutlineItem {
  title: string
  overview: string
}

export interface DeepResearchFormConfig {
  mode: ResearchMode
  depth: ResearchDepth
  manual_subtopics?: number
  manual_max_iterations?: number
  confirmed_outline?: OutlineItem[]
}

export interface ResearchConfigValidationResult {
  valid: boolean
  errors: Record<string, string>
}

export const RESEARCH_MODES: Array<{ value: Exclude<ResearchMode, ''>; label: string }> = [
  { value: 'notes', label: '学习笔记' },
  { value: 'report', label: '研究报告' },
  { value: 'comparison', label: '对比分析' },
  { value: 'learning_path', label: '学习路径' },
]

export const RESEARCH_DEPTHS: Array<{ value: Exclude<ResearchDepth, ''>; label: string }> = [
  { value: 'quick', label: '快速' },
  { value: 'standard', label: '标准' },
  { value: 'deep', label: '深入' },
  { value: 'manual', label: '手动' },
]

export function createEmptyResearchConfig(): DeepResearchFormConfig {
  return { mode: '', depth: '' }
}

/** Coerce untrusted input into a known research config, dropping extras. */
export function normalizeResearchConfig(raw: Record<string, unknown> | undefined): DeepResearchFormConfig {
  const empty = createEmptyResearchConfig()
  return {
    mode:
      raw?.mode === 'notes' ||
      raw?.mode === 'report' ||
      raw?.mode === 'comparison' ||
      raw?.mode === 'learning_path'
        ? raw.mode
        : empty.mode,
    depth:
      raw?.depth === 'quick' ||
      raw?.depth === 'standard' ||
      raw?.depth === 'deep' ||
      raw?.depth === 'manual'
        ? raw.depth
        : empty.depth,
  }
}

export function validateResearchConfig(cfg: DeepResearchFormConfig): ResearchConfigValidationResult {
  const errors: Record<string, string> = {}
  if (!cfg.mode) errors.mode = '必选'
  if (!cfg.depth) errors.depth = '必选'
  return { valid: Object.keys(errors).length === 0, errors }
}

export function buildResearchWSConfig(
  cfg: DeepResearchFormConfig,
  confirmedOutline?: OutlineItem[],
): Record<string, unknown> {
  const validation = validateResearchConfig(cfg)
  if (!validation.valid) throw new Error('深入研究设置不完整。')
  const result: Record<string, unknown> = { mode: cfg.mode, depth: cfg.depth }
  if (cfg.depth === 'manual') {
    if (cfg.manual_subtopics != null) result.manual_subtopics = cfg.manual_subtopics
    if (cfg.manual_max_iterations != null) result.manual_max_iterations = cfg.manual_max_iterations
  }
  const outline = confirmedOutline ?? cfg.confirmed_outline
  if (outline && outline.length > 0) result.confirmed_outline = outline
  return result
}

export function summarizeResearchConfig(
  cfg: DeepResearchFormConfig,
  translate?: (key: string) => string,
): string {
  const tr = translate ?? ((s: string) => s)
  if (!validateResearchConfig(cfg).valid) return tr('设置不完整')
  const mode = RESEARCH_MODES.find(m => m.value === cfg.mode)?.label ?? String(cfg.mode).replace('_', ' ')
  const depth = RESEARCH_DEPTHS.find(d => d.value === cfg.depth)?.label ?? cfg.depth
  return [tr(mode), tr(depth)].join(' · ')
}

/** Validate and normalize a manually edited outline (trim, drop empty titles). */
export function normalizeOutline(items: OutlineItem[] | undefined): OutlineItem[] {
  if (!Array.isArray(items)) return []
  return items
    .map(item => ({ title: String(item.title ?? '').trim(), overview: String(item.overview ?? '').trim() }))
    .filter(item => item.title.length > 0)
}
