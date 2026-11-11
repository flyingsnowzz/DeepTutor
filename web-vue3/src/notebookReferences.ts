export interface NotebookSummary { id: string; name: string; description?: string; record_count?: number; color?: string }
export interface NotebookRecord { id: string; title: string; summary?: string; user_query?: string; output?: string; type: string }
export interface SelectedNotebookRecord extends NotebookRecord { notebookId: string; notebookName: string }
export interface NotebookReferencePayload { notebook_id: string; record_ids: string[] }
export function selectedRecordsToPayload(records: SelectedNotebookRecord[]): NotebookReferencePayload[] {
  const grouped = new Map<string, string[]>()
  records.forEach(record => grouped.set(record.notebookId, [...(grouped.get(record.notebookId) || []), record.id]))
  return [...grouped.entries()].map(([notebook_id, record_ids]) => ({ notebook_id, record_ids: [...new Set(record_ids)] }))
}
