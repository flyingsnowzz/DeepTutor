/**
 * Math animator result extraction — Vue3 port of web/lib/math-animator-types.ts.
 */

export type MathAnimatorOutputMode = 'video' | 'image'

export interface MathAnimatorArtifact {
  type: MathAnimatorOutputMode | string
  url: string
  filename: string
  content_type?: string
  label?: string
}

export interface MathAnimatorVisualReview {
  passed?: boolean
  summary?: string
  issues?: string[]
  suggested_fix?: string
  reviewed_frames?: number
}

export interface MathAnimatorResult {
  response: string
  output_mode: MathAnimatorOutputMode
  code: {
    language: string
    content: string
  }
  artifacts: MathAnimatorArtifact[]
  timings: Record<string, number>
  render: {
    quality?: string
    retry_attempts?: number
    retry_history?: Array<{ attempt: number; error: string }>
    source_code_path?: string
    visual_review?: MathAnimatorVisualReview | null
  }
  summary?: {
    summary_text?: string
    user_request?: string
    generated_output?: string
    key_points?: string[]
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function numberRecord(value: unknown): Record<string, number> {
  const source = record(value)
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(source)) {
    const number = Number(raw)
    if (Number.isFinite(number)) result[key] = number
  }
  return result
}

function artifact(value: unknown): MathAnimatorArtifact | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.type !== 'string' || typeof item.url !== 'string' || typeof item.filename !== 'string') {
    return null
  }
  return {
    type: item.type,
    url: item.url,
    filename: item.filename,
    content_type: typeof item.content_type === 'string' ? item.content_type : undefined,
    label: typeof item.label === 'string' ? item.label : undefined,
  }
}

/** Extract a math animator result, rejecting generic response-only events. */
export function extractMathAnimatorResult(
  resultMetadata: Record<string, unknown> | undefined,
): MathAnimatorResult | null {
  if (!resultMetadata) return null
  const artifacts = (Array.isArray(resultMetadata.artifacts) ? resultMetadata.artifacts : [])
    .map(artifact)
    .filter((item): item is MathAnimatorArtifact => item !== null)
  const codeRaw = record(resultMetadata.code)
  const hasOutputMode = resultMetadata.output_mode === 'image' || resultMetadata.output_mode === 'video'
  const timings = numberRecord(resultMetadata.timings)
  const render = record(resultMetadata.render)

  if (
    artifacts.length === 0 &&
    !codeRaw.content &&
    !hasOutputMode &&
    Object.keys(timings).length === 0 &&
    Object.keys(render).length === 0
  ) {
    return null
  }

  return {
    response: String(resultMetadata.response ?? ''),
    output_mode: resultMetadata.output_mode === 'image' ? 'image' : 'video',
    code: {
      language: String(codeRaw.language ?? 'python'),
      content: String(codeRaw.content ?? ''),
    },
    artifacts,
    timings,
    render: render as MathAnimatorResult['render'],
    summary: resultMetadata.summary && typeof resultMetadata.summary === 'object'
      ? (resultMetadata.summary as MathAnimatorResult['summary'])
      : undefined,
  }
}

export function mathArtifactsByType(result: MathAnimatorResult, type: MathAnimatorOutputMode) {
  return result.artifacts.filter(item => item.type === type)
}
