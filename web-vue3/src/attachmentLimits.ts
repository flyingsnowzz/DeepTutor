import { api } from './api'
import { DEFAULT_MAX_ATTACHMENT_BYTES, DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES } from './attachmentTypes'
export interface AttachmentLimits { maxFileBytes: number; maxTotalBytes: number }
export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = { maxFileBytes: DEFAULT_MAX_ATTACHMENT_BYTES, maxTotalBytes: DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES }
let cached: AttachmentLimits | null = null
let inflight: Promise<AttachmentLimits> | null = null
export function loadAttachmentLimits(): Promise<AttachmentLimits> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) inflight = api<{ effective?: { max_file_bytes?: number; max_total_bytes?: number } }>('/api/settings/chat-attachments').then(result => {
    const fileBytes = Number(result.effective?.max_file_bytes)
    const totalBytes = Number(result.effective?.max_total_bytes)
    if (!Number.isFinite(fileBytes) || fileBytes <= 0) return DEFAULT_ATTACHMENT_LIMITS
    cached = { maxFileBytes: fileBytes, maxTotalBytes: Number.isFinite(totalBytes) && totalBytes >= fileBytes ? totalBytes : fileBytes }
    return cached
  }).catch(() => DEFAULT_ATTACHMENT_LIMITS).finally(() => { inflight = null })
  return inflight
}
