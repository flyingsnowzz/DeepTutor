import { describe, expect, it } from 'vitest'
import { extractPartnerDraft } from '../partnerDraft'

describe('partner draft signals', () => {
  it('extracts and validates the latest partner proposal', () => {
    const draft = extractPartnerDraft([{
      type: 'tool_result',
      metadata: {
        tool_metadata: {
          partner_draft: {
            draft_id: 'a'.repeat(32),
            name: 'Coach',
            description: 'Learning coach',
            soul: 'Be supportive.',
            language: 'zh',
            emoji: '🎓',
            color: '#123456',
            status: 'pending',
            version: 2,
          },
        },
      },
    }])
    expect(draft?.name).toBe('Coach')
    expect(draft?.status).toBe('pending')
    expect(extractPartnerDraft([{ type: 'tool_result', metadata: { partner_draft: { draft_id: 'bad' } } }])).toBeNull()
  })
})
