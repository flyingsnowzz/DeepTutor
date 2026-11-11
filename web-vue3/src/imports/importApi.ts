import { post } from '../api'
import type { ImportSource, NormalizedSession } from './chat-import/types'

export interface ImportResult { imported: number; skipped: number; sessions: { external_id: string; session_id?: string; imported: boolean; reason?: string }[] }
export async function importChatHistoryInBatches(source: ImportSource, sessions: NormalizedSession[], agent: { id: string; name: string }, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  if (!sessions.length) throw new Error('No sessions to import')
  const combined: ImportResult = { imported: 0, skipped: 0, sessions: [] }
  for (let start = 0; start < sessions.length; start += 100) {
    const result = await post<ImportResult>('/api/imports/chat-history', { source, sessions: sessions.slice(start, start + 100), agent_id: agent.id, agent_name: agent.name })
    combined.imported += result.imported
    combined.skipped += result.skipped
    combined.sessions.push(...(result.sessions || []))
    onProgress?.(Math.min(start + 100, sessions.length), sessions.length)
  }
  return combined
}
