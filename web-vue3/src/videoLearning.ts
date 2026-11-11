import { api } from './api'

export type VideoProvider = 'youtube' | 'invidious'
export type VideoMarkKind = 'key_point' | 'question' | 'review'
export type VideoMarkAuthor = 'user' | 'assistant'

export interface TranscriptCue {
  start: number
  end: number
  text: string
}

export interface TimedSegment extends TranscriptCue {
  locator: number
}

export interface VideoLearningMark {
  mark_id: string
  kind: VideoMarkKind
  start_seconds: number
  end_seconds: number
  start_locator: number
  end_locator: number
  quote: string
  note: string
  author: VideoMarkAuthor
  source?: 'immersive'
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
  reviewed_at?: string
}

export interface VideoMarkSuggestion {
  kind: VideoMarkKind
  start_seconds: number
  end_seconds: number
  start_locator: number
  end_locator: number
  quote: string
  note: string
  author: VideoMarkAuthor
}

export type VideoPlayback =
  | {
      provider: 'youtube'
      kind: 'youtube_iframe'
      video_id: string
      start_seconds: number
    }
  | {
      provider: 'invidious'
      kind: 'html5'
      format_id: string
      mime_type: string
      stream_url: string
      subtitles_url: string
      start_seconds: number
    }

export interface TimedMediaMaterial {
  version: number
  type: 'timed_media'
  material_id: string
  source: {
    provider: 'youtube' | 'invidious'
    video_id: string
    url: string
    entry_time_seconds: number
  }
  metadata: {
    title: string
    author: string
    duration_seconds: number
    thumbnail_url?: string
  }
  transcript: {
    status: 'ready' | 'unavailable'
    reason: string
    language: string
    source: string
    cues: TranscriptCue[]
  }
  segments: TimedSegment[]
  learning: {
    last_position: number
    marks?: VideoLearningMark[]
  }
  playback: VideoPlayback
}

export interface InvidiousAccountStatus {
  connected: boolean
  needs_reauthorization?: boolean
  authorize_url?: string
}

export interface InvidiousVideo {
  videoId: string
  title: string
  author: string
  lengthSeconds: number
  videoThumbnails?: Array<{ url: string }>
}

export interface InvidiousPlaylist {
  playlistId: string
  title: string
  videoCount: number
  videos?: InvidiousVideo[]
}

export type InvidiousCatalog = { videos?: InvidiousVideo[] }

function materialPath(materialId: string, path: string) {
  return `/api/video-learning/materials/${encodeURIComponent(materialId)}${path}`
}

export async function listVideoMarks(materialId: string): Promise<VideoLearningMark[]> {
  return api<VideoLearningMark[]>(materialPath(materialId, '/marks'))
}

export async function getVideoMaterial(materialId: string): Promise<TimedMediaMaterial> {
  return api<TimedMediaMaterial>(materialPath(materialId, ''))
}

export async function refreshInvidiousTranscript(materialId: string): Promise<TimedMediaMaterial> {
  return api<TimedMediaMaterial>(materialPath(materialId, '/transcript/refresh'), { method: 'POST' })
}

export async function createVideoMark(
  materialId: string,
  payload: {
    kind: VideoMarkKind
    start_seconds: number
    end_seconds?: number | null
    start_locator?: number
    end_locator?: number
    quote?: string
    note?: string
  },
): Promise<VideoLearningMark> {
  return api<VideoLearningMark>(materialPath(materialId, '/marks'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateVideoMark(
  materialId: string,
  markId: string,
  payload: Partial<{ reviewed: boolean; note: string }>,
): Promise<VideoLearningMark> {
  return api<VideoLearningMark>(materialPath(materialId, `/marks/${encodeURIComponent(markId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteVideoMark(materialId: string, markId: string): Promise<void> {
  await api(materialPath(materialId, `/marks/${encodeURIComponent(markId)}`), { method: 'DELETE' })
}

export async function suggestVideoMarks(
  materialId: string,
  timeSeconds = 0,
): Promise<VideoMarkSuggestion[]> {
  const payload = await api<{ suggestions?: VideoMarkSuggestion[] }>(
    materialPath(materialId, '/mark-suggestions'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_seconds: timeSeconds }),
    },
  )
  return payload.suggestions ?? []
}

export async function saveVideoProgress(
  materialId: string,
  timeSeconds: number,
  durationSeconds: number,
): Promise<void> {
  await api(materialPath(materialId, '/progress'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      time_seconds: Math.max(0, timeSeconds),
      duration_seconds: Math.max(0, durationSeconds),
    }),
  })
}

export async function invidiousAccount(action: 'status' | 'authorize' | 'disconnect') {
  return api<InvidiousAccountStatus>(`/api/video-learning/invidious/account/${action}`, {
    method: action === 'status' ? 'GET' : 'POST',
  })
}

export async function browseInvidious(
  kind: string,
  query: string,
  page: number,
  playlistId: string,
  signal?: AbortSignal,
): Promise<InvidiousVideo[] | InvidiousPlaylist[] | InvidiousCatalog> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    playlist_id: playlistId,
  })
  return api<InvidiousVideo[] | InvidiousPlaylist[] | InvidiousCatalog>(
    `/api/video-learning/invidious/browse/${encodeURIComponent(kind)}?${params}`,
    { signal },
  )
}
