import { scopedUrl } from './workspaceScope'

export interface SubagentStreamLine {
  channel?: string
  text?: string
  merge_id?: string
  done?: boolean
  success?: boolean
  session_id?: string
}

export async function* streamSubagentMessage(
  name: string,
  body: { chat_session_id: string; message: string },
  signal?: AbortSignal,
): AsyncGenerator<SubagentStreamLine> {
  const response = await fetch(scopedUrl(`/api/subagents/connections/${encodeURIComponent(name)}/message`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || !response.body) throw new Error(`Agent message failed: ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const parse = function* (chunk: string): Generator<SubagentStreamLine> {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) yield JSON.parse(line) as SubagentStreamLine
      newline = buffer.indexOf('\n')
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    yield* parse(decoder.decode(value, { stream: true }))
  }
  const tail = buffer.trim()
  if (tail) yield JSON.parse(tail) as SubagentStreamLine
}
