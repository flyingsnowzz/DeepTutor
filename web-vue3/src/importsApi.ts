import { api } from './api'
export interface ImportedSession { id: string; session_id: string; title: string; created_at: number; updated_at: number; message_count: number; last_message?: string; preferences?: { import?: { source?: string; source_cwd?: string; agent_id?: string } } }
export async function listImportedSessions(limit = 200, offset = 0): Promise<ImportedSession[]> {
  return (await api<{ sessions: ImportedSession[] }>(`/api/imports/chat-history?limit=${limit}&offset=${offset}`)).sessions || []
}
