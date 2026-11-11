import { describe, expect, it } from 'vitest'
import { selectedRecordsToPayload, type SelectedNotebookRecord } from '../notebookReferences'

describe('notebook reference payload', () => {
  it('groups records by notebook and deduplicates ids', () => {
    const record = (id: string, notebookId: string): SelectedNotebookRecord => ({ id, notebookId, notebookName: notebookId === 'n1' ? 'Notes' : 'Review', title: id, type: 'chat' })
    expect(selectedRecordsToPayload([record('r1', 'n1'), record('r1', 'n1'), record('r2', 'n1'), record('r3', 'n2')])).toEqual([
      { notebook_id: 'n1', record_ids: ['r1', 'r2'] },
      { notebook_id: 'n2', record_ids: ['r3'] },
    ])
  })
})
