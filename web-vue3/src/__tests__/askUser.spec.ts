import { describe, expect, it } from 'vitest'
import { buildAskUserReply, extractAskUserPayload } from '../askUser'

describe('ask user card', () => {
  it('normalizes legacy and v2 tool_result payloads', () => {
    const card = extractAskUserPayload([
      {
        type: 'tool_result',
        tool_call_id: 'call1',
        metadata: {
          tool_metadata: {
            ask_user: {
              intro: 'Need a choice',
              questions: [
                {
                  prompt: 'Which pace?',
                  options: [{ label: 'Fast', description: 'Quick' }, 'Slow'],
                  multi_select: false,
                },
              ],
            },
          },
        },
      },
    ])
    expect(card?.resolved).toBe(false)
    expect(card?.payload.questions[0]?.options).toEqual([
      { label: 'Fast', description: 'Quick' },
      { label: 'Slow', description: null },
    ])
  })

  it('shows a streaming draft until the real tool result arrives', () => {
    const draft = extractAskUserPayload(
      [
        {
          type: 'progress',
          metadata: {
            ask_user_draft: { intro: 'Preparing…', questions: [] },
            draft_call_id: 'call123',
          },
        },
      ],
      { streaming: true },
    )
    expect(draft?.streaming).toBe(true)
    expect(extractAskUserPayload([{ type: 'progress', metadata: { ask_user_draft: { intro: 'x' } } }])).toBeNull()
  })

  it('marks the matching tool call resolved with structured answers', () => {
    const card = extractAskUserPayload([
      {
        type: 'tool_result',
        tool_call_id: 'call1',
        metadata: { tool_metadata: { ask_user: { question: 'Done?', options: ['Yes'] } } },
      },
      {
        type: 'progress',
        metadata: {
          ask_user_resolved: true,
          ask_user_tool_call_id: 'call1',
          answers: [{ questionId: 'q_1', text: 'Yes' }],
          reply_preview: 'Yes',
        },
      },
    ])
    expect(card?.resolved).toBe(true)
    expect(card?.answers).toEqual([{ questionId: 'q_1', text: 'Yes' }])
  })

  it('builds flat text and structured answers', () => {
    const payload = {
      intro: null,
      questions: [
        { id: 'q1', prompt: 'A', header: null, multi_select: false, options: [], allow_free_text: true, placeholder: null },
        { id: 'q2', prompt: 'B', header: null, multi_select: false, options: [], allow_free_text: true, placeholder: null },
      ],
    }
    expect(buildAskUserReply(payload, { q1: 'Fast', q2: ' ' })).toEqual({
      answers: [
        { questionId: 'q1', text: 'Fast' },
        { questionId: 'q2', text: '' },
      ],
      text: 'Fast',
    })
  })
})
