export interface DiagnosticsResult {
  state: 'success' | 'failed'
  message: string
  profileId: string | null
  modelId: string | null
}

const KEY = 'deeptutor.settings.diagnosticsResults.v1'

export function readDiagnosticsResults(): Record<string, DiagnosticsResult> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, DiagnosticsResult>
      : {}
  } catch {
    return {}
  }
}

export function saveDiagnosticsResult(service: string, result: DiagnosticsResult): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...readDiagnosticsResults(), [service]: result }))
  } catch {
    // Connection testing still works when browser storage is unavailable.
  }
}

export function currentDiagnosticsResult(
  catalog: Record<string, any> | null,
  service: string,
  results: Record<string, DiagnosticsResult>,
): DiagnosticsResult | null {
  const config = catalog?.services?.[service]
  const result = results[service]
  if (!config || !result) return null
  const profileId = config.active_profile_id ?? null
  const modelId = service === 'search' ? null : config.active_model_id ?? null
  return result.profileId === profileId && result.modelId === modelId ? result : null
}
