import { describe, expect, it } from 'vitest'
import {
  phaseLabel,
  selectAttachmentProcessing,
  type ProcessingMessage,
} from '../attachmentProcessing'

function progressEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'progress',
    source: 'attachment_parsing',
    content: '正在解析',
    metadata: { phase: 'parsing', attachment_id: 'a1', filename: 'doc.pdf', ...overrides },
  }
}

describe('selectAttachmentProcessing', () => {
  it('returns empty when not streaming and there is no latest assistant turn', () => {
    expect(selectAttachmentProcessing([{ role: 'user', attachments: [] }], false)).toEqual([])
  })

  it('ignores unrelated events', () => {
    const messages: ProcessingMessage[] = [
      { role: 'user', attachments: [{ filename: 'doc.pdf', mime_type: 'application/pdf' }] },
      { role: 'assistant', events: [{ type: 'tool_call', source: 'other' }] },
    ]
    const result = selectAttachmentProcessing(messages, true)
    expect(result.every(item => item.phase === 'uploading')).toBe(true)
    expect(result).toHaveLength(1)
  })

  it('maps valid parsing events and de-duplicates by attachment id', () => {
    const messages: ProcessingMessage[] = [
      { role: 'user', attachments: [{ filename: 'doc.pdf', mime_type: 'application/pdf' }] },
      {
        role: 'assistant',
        events: [
          progressEvent({ phase: 'received' }),
          progressEvent({ phase: 'parsing' }),
        ],
      },
    ]
    const result = selectAttachmentProcessing(messages, true)
    const parsing = result.filter(item => item.attachmentId === 'a1')
    expect(parsing).toHaveLength(1)
    expect(parsing[0].phase).toBe('parsing')
    expect(parsing[0].filename).toBe('doc.pdf')
  })

  it('drops unknown phases', () => {
    const messages: ProcessingMessage[] = [
      { role: 'user', attachments: [] },
      { role: 'assistant', events: [progressEvent({ phase: 'mystery' })] },
    ]
    expect(selectAttachmentProcessing(messages, true)).toEqual([])
  })

  it('keeps only failed/fallback rows once streaming settles', () => {
    const messages: ProcessingMessage[] = [
      { role: 'user', attachments: [] },
      {
        role: 'assistant',
        events: [
          progressEvent({ attachment_id: 'ok', phase: 'completed', filename: 'a.pdf' }),
          progressEvent({ attachment_id: 'bad', phase: 'failed', filename: 'b.pdf' }),
        ],
      },
    ]
    const result = selectAttachmentProcessing(messages, false)
    expect(result.map(item => item.attachmentId)).toEqual(['bad'])
  })

  it('synthesizes uploading rows for PDFs without a server event', () => {
    const messages: ProcessingMessage[] = [
      {
        role: 'user',
        attachments: [
          { filename: 'one.pdf', mime_type: 'application/pdf' },
          { filename: 'note.txt', mime_type: 'text/plain' },
        ],
      },
      { role: 'assistant', events: [] },
    ]
    const result = selectAttachmentProcessing(messages, true)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ phase: 'uploading', filename: 'one.pdf' })
  })
})

describe('phaseLabel', () => {
  it('maps phases to Chinese labels', () => {
    expect(phaseLabel('parsing')).toBe('解析中')
    expect(phaseLabel('failed')).toBe('失败')
    expect(phaseLabel('uploading')).toBe('上传中')
  })
})
