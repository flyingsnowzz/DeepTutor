type StreamLikeEvent = { type?: string; metadata?: unknown }

export interface PartnerDraftData {
  draft_id: string
  owner_id: string
  name: string
  description: string
  soul: string
  language: string
  emoji: string
  color: string
  status: 'pending' | 'created'
  created_partner_id?: string
  version: number
}

function toolResultMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  return record.tool_metadata && typeof record.tool_metadata === 'object'
    ? record.tool_metadata as Record<string, unknown>
    : null
}

export function extractPartnerDraft(events: StreamLikeEvent[] | undefined): PartnerDraftData | null {
  if (!events?.length) return null
  let latest: PartnerDraftData | null = null
  for (const event of events) {
    if (event.type !== 'tool_result') continue
    const raw = toolResultMetadata(event.metadata)?.partner_draft
    if (!raw || typeof raw !== 'object') continue
    const payload = raw as Record<string, unknown>
    const draftId = String(payload.draft_id ?? '').trim()
    const name = String(payload.name ?? '').trim()
    const soul = String(payload.soul ?? '').trim()
    if (!/^[a-f0-9]{32}$/.test(draftId) || !name || !soul) continue
    latest = {
      draft_id: draftId,
      owner_id: String(payload.owner_id ?? ''),
      name,
      description: String(payload.description ?? ''),
      soul,
      language: String(payload.language ?? ''),
      emoji: String(payload.emoji ?? ''),
      color: String(payload.color ?? ''),
      status: payload.status === 'created' ? 'created' : 'pending',
      created_partner_id: String(payload.created_partner_id ?? ''),
      version: Number(payload.version ?? 1),
    }
  }
  return latest
}
