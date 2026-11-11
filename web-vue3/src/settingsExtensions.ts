export interface AttachmentSettings {
  max_file_mb: number
  max_total_mb: number
  max_chars_per_doc: number
  max_chars_total: number
}

export interface AttachmentSettingsPayload {
  settings: AttachmentSettings
  effective?: {
    max_file_bytes: number
    max_total_bytes: number
    max_chars_per_doc: number
    max_chars_total: number
    ws_max_size: number
  }
  bounds?: {
    max_file_mb: [number, number]
    max_total_mb: [number, number]
    chars: [number, number]
  }
  restart_required_for_larger_uploads?: boolean
}

export interface StarterSettingsPayload {
  settings: { trace_count: number }
  bounds?: { trace_count: [number, number] }
}

/** A larger upload cap cannot pass through the process's fixed WS frame limit until restart. */
export function largerAttachmentUploadsNeedRestart(
  previous: AttachmentSettings,
  next: AttachmentSettings,
  payload: AttachmentSettingsPayload,
): boolean {
  if (!payload.restart_required_for_larger_uploads) return false
  return next.max_file_mb > previous.max_file_mb || next.max_total_mb > previous.max_total_mb
}

export function clampToRange(value: number, range: [number, number]): number {
  return Math.min(range[1], Math.max(range[0], value))
}

export function effectiveAttachmentLimits(payload: AttachmentSettingsPayload | null) {
  return payload?.effective ?? null
}
