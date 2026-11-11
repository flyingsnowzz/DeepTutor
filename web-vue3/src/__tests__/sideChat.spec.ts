import { describe, expect, it } from 'vitest'
import {
  applySideChatEvent,
  buildSideChatStartCommand,
  DITO,
  emptySideChatState,
  responderFromPreferences,
  sameResponder,
  sideChatTurnConfig,
} from '../sideChat'

describe('side chat', () => {
  it('builds Dito context and responder-specific turn config', () => {
    expect(
      sideChatTurnConfig({ parentSessionId: 's1', leafMessageId: 4, responder: DITO }),
    ).toEqual({
      selection_tutor_context: { parent_session_id: 's1', source_message_id: 4 },
      answer_by: '',
    })
    expect(
      sideChatTurnConfig({
        parentSessionId: 's1',
        leafMessageId: 4,
        responder: { kind: 'partner_group', id: 'g1', name: 'Group' },
      }),
    ).toMatchObject({ answer_by: '', partner_discussion_group_id: 'g1' })
    expect(sameResponder(DITO, DITO)).toBe(true)
    expect(sameResponder({ kind: 'partner', id: 'p1', name: 'P' }, { kind: 'partner', id: 'p1', name: 'P2' })).toBe(true)
  })

  it('hydrates stored responders and folds streamed side-chat events', () => {
    expect(responderFromPreferences({ answer_by: 'partner:p1' })).toEqual({
      kind: 'partner',
      id: 'p1',
      name: 'p1',
    })
    expect(responderFromPreferences({ side_chat_group_id: 'g1' }).kind).toBe('partner_group')

    let state = emptySideChatState()
    state = { ...state, messages: [{ role: 'user', content: 'Why?' }], busy: true }
    state = applySideChatEvent(state, { type: 'session_meta', session_id: 'side-1', turn_id: 't1' })
    state = applySideChatEvent(state, { type: 'content', content: 'Because.' })
    state = applySideChatEvent(state, { type: 'done' })
    expect(state.sessionId).toBe('side-1')
    expect(state.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Because.' })
    expect(state.busy).toBe(false)
  })

  it('creates a chat-only start command with optional quote attachment', () => {
    const command = buildSideChatStartCommand({
      content: 'Explain this',
      context: { parentSessionId: 's1', leafMessageId: null, responder: DITO },
      sessionId: 'side-1',
      language: 'zh',
      attachments: [{ type: 'quote', base64: 'aGVsbG8=' }],
      memoryReferences: ['summary'],
      historyReferences: ['history-1'],
      questionNotebookReferences: [7],
    })
    expect(command).toMatchObject({
      capability: 'chat',
      session_id: 'side-1',
      language: 'zh',
      knowledge_bases: [],
      attachments: [{ type: 'quote', base64: 'aGVsbG8=' }],
      memory_references: ['summary'],
      history_references: ['history-1'],
      question_notebook_references: [7],
    })
  })
})
