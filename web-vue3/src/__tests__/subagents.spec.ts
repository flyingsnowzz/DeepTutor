import { describe, expect, it, vi } from 'vitest'
import { streamSubagentMessage } from '../subagents'

describe('subagent direct message stream', () => {
  it('posts to the connected agent endpoint and parses NDJSON chunks', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"channel":"text","text":"Hel'))
        controller.enqueue(encoder.encode('lo"}\n{"channel":"result","text":"Done","done":true}\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const lines = []
    for await (const line of streamSubagentMessage('Codex', { chat_session_id: 's1', message: 'Review' })) {
      lines.push(line)
    }
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/subagents/connections/Codex/message'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(lines).toEqual([
      { channel: 'text', text: 'Hello' },
      { channel: 'result', text: 'Done', done: true },
    ])
    vi.unstubAllGlobals()
  })
})
