export interface SetupCredentialData {
  service: string
  label: string
  settingsPath: string
  reason: string
}

interface SetupLikeEvent {
  type?: string
  seq?: number
  tool_call_id?: string
  metadata?: Record<string, unknown>
}

interface SetupLikeMessage {
  events?: SetupLikeEvent[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function toolResultMetadata(metadata: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(metadata)?.tool_metadata)
}

/** Credentials must be entered in Settings, never pasted into a model turn. */
export function extractSetupCredential(
  events: SetupLikeEvent[] | undefined,
): SetupCredentialData | null {
  if (!events?.length) return null
  let latest: SetupCredentialData | null = null
  for (const event of events) {
    if (event.type !== 'tool_result') continue
    const metadata = toolResultMetadata(event.metadata)
    const raw = asRecord(metadata?.setup_credential)
    if (!raw) continue
    const settingsPath = String(raw.settings_path ?? '').trim()
    if (!settingsPath.startsWith('/settings')) continue
    latest = {
      service: String(raw.service ?? ''),
      label: String(raw.label ?? ''),
      settingsPath,
      reason: String(raw.reason ?? ''),
    }
  }
  return latest
}

/** Stable ids for every setup_applied signal; replayed history is handled once. */
export function collectAppliedSettingIds(messages: readonly SetupLikeMessage[] | undefined): string[] {
  if (!messages?.length) return []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    for (const event of message.events ?? []) {
      if (event.type !== 'tool_result') continue
      const metadata = toolResultMetadata(event.metadata)
      const applied = asRecord(metadata?.setup_applied)
      if (!applied) continue
      const outer = asRecord(event.metadata)
      const callId =
        event.tool_call_id ??
        (typeof outer?.tool_call_id === 'string' ? outer.tool_call_id : '')
      const key = String(applied.key ?? '')
      const id = callId || (key ? `${key}:${event.seq ?? ''}` : '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}
