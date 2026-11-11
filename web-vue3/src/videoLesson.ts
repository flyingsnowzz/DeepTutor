/**
 * Video lesson result extraction — Vue3 port of web/lib/video-lesson-types.ts.
 */

export interface VideoLessonArtifact {
  type: 'html' | string
  url: string
  filename?: string
  content_type?: string
  label?: string
}

export interface VideoLessonResult {
  response: string
  title: string
  page: VideoLessonArtifact
  code: string
  durationSeconds: number | null
  attempts: number
}

export interface VideoLessonEvent {
  type?: string
  source?: string
  metadata?: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Extract the playable Remotion HTML page from a video_lesson result event. */
export function extractVideoLessonResult(
  resultMetadata: Record<string, unknown> | undefined,
): VideoLessonResult | null {
  if (!resultMetadata) return null
  const artifacts = Array.isArray(resultMetadata.artifacts) ? resultMetadata.artifacts : []
  const page = artifacts.find((item): item is VideoLessonArtifact => {
    if (!item || typeof item !== 'object') return false
    const artifact = item as Record<string, unknown>
    return (
      artifact.type === 'html' &&
      typeof artifact.url === 'string' &&
      artifact.url.trim().length > 0
    )
  })
  if (!page) return null

  const codeRecord = record(resultMetadata.code)
  const render = record(resultMetadata.render)
  const rawDuration = Number(render.duration_seconds)
  const attempts = Array.isArray(render.attempts) ? render.attempts.length : 0

  return {
    response: String(resultMetadata.response ?? ''),
    title: String(resultMetadata.title ?? page.label ?? ''),
    page,
    code: String(codeRecord.content ?? ''),
    durationSeconds: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null,
    attempts,
  }
}

/**
 * Find the latest playable result. A resumed turn may still have message
 * capability `chat`; in that case `event.source === 'video_lesson'` is
 * authoritative. Earlier non-playable intermediate results are skipped.
 */
export function videoLessonFromMessage(
  events: VideoLessonEvent[] | undefined,
  messageCapability: string | undefined,
): VideoLessonResult | null {
  if (!events?.length) return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.type !== 'result') continue
    if (event.source !== 'video_lesson' && messageCapability !== 'video_lesson') continue
    const lesson = extractVideoLessonResult(event.metadata)
    if (lesson) return lesson
  }
  return null
}
