/**
 * Attachment processing state — derive per-file parser progress from turn
 * stream events. Port of web/features/chat/selectors/attachment-processing.ts.
 * Pure function so the phase mapping is unit-testable without a WebSocket.
 */

export type AttachmentProcessingPhase =
  | 'uploading'
  | 'received'
  | 'submitting'
  | 'parsing'
  | 'retrieving'
  | 'completed'
  | 'fallback'
  | 'failed'

export interface AttachmentProcessingItem {
  attachmentId: string
  filename: string
  phase: AttachmentProcessingPhase
  detail: string
}

export interface ProcessingEvent {
  type: string
  source?: string
  stage?: string
  content?: string
  metadata?: Record<string, unknown>
}

export interface ProcessingMessage {
  role: string
  events?: ProcessingEvent[]
  attachments?: Array<{ filename?: string; mime_type?: string }>
}

const PHASES = new Set<AttachmentProcessingPhase>([
  'received',
  'submitting',
  'parsing',
  'retrieving',
  'completed',
  'fallback',
  'failed',
])

function asString(value: unknown): string {
  return value == null ? '' : String(value)
}

function parsingEvent(event: ProcessingEvent): AttachmentProcessingItem | null {
  if (event.type !== 'progress' || event.source !== 'attachment_parsing') return null
  const phase = asString(event.metadata?.phase || event.stage)
  if (!PHASES.has(phase as AttachmentProcessingPhase)) return null
  const attachmentId = asString(event.metadata?.attachment_id)
  const filename = asString(event.metadata?.filename) || 'PDF attachment'
  return {
    attachmentId: attachmentId || filename,
    filename,
    phase: phase as AttachmentProcessingPhase,
    detail: (event.content || '').trim(),
  }
}

function isPdf(attachment: { filename?: string; mime_type?: string }): boolean {
  return (
    attachment.mime_type === 'application/pdf' ||
    (attachment.filename || '').toLowerCase().endsWith('.pdf')
  )
}

/**
 * Latest truthful parser state per attachment in the latest turn. Terminal
 * success rows disappear once streaming stops; fallback/failed stay visible.
 */
export function selectAttachmentProcessing(
  messages: ProcessingMessage[],
  isStreaming: boolean,
): AttachmentProcessingItem[] {
  let userIndex = -1
  let assistantIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (assistantIndex === -1 && messages[i].role === 'assistant') assistantIndex = i
    if (userIndex === -1 && messages[i].role === 'user') userIndex = i
    if (assistantIndex !== -1 && userIndex !== -1) break
  }
  const latest = assistantIndex > userIndex ? messages[assistantIndex] : null
  if (!latest && !isStreaming) return []

  const byAttachment = new Map<string, AttachmentProcessingItem>()
  for (const event of latest?.events ?? []) {
    const item = parsingEvent(event)
    if (item) byAttachment.set(item.attachmentId, item)
  }
  const items = [...byAttachment.values()]

  // Before the first server progress event the PDF is still travelling in the
  // start_turn payload — a stage, not a byte percentage (WS.send exposes none).
  if (isStreaming && userIndex >= 0) {
    const receivedByName = new Map<string, number>()
    for (const item of items) {
      receivedByName.set(item.filename, (receivedByName.get(item.filename) ?? 0) + 1)
    }
    (messages[userIndex].attachments ?? []).forEach((attachment, index) => {
      if (!isPdf(attachment)) return
      const filename = attachment.filename ?? ''
      const received = receivedByName.get(filename) ?? 0
      if (received) {
        receivedByName.set(filename, received - 1)
      } else {
        items.push({ attachmentId: `uploading:${index}`, filename, phase: 'uploading', detail: '' })
      }
    })
  }

  if (isStreaming) return items
  return items.filter(item => item.phase === 'failed' || item.phase === 'fallback')
}

const PHASE_LABELS: Record<AttachmentProcessingPhase, string> = {
  uploading: '上传中',
  received: '已接收',
  submitting: '提交中',
  parsing: '解析中',
  retrieving: '检索中',
  completed: '已完成',
  fallback: '已降级',
  failed: '失败',
}

export function phaseLabel(phase: AttachmentProcessingPhase): string {
  return PHASE_LABELS[phase] ?? phase
}
