/**
 * Live voice discovery — POST /api/settings/voice/voices.
 * Vue3 port of web/components/settings/VoiceDiscoveryField.tsx state machine,
 * web/lib/model-settings.ts modelTestFingerprint, and
 * web/lib/provider-registry.ts modelProvider/modelProviderRef.
 *
 * The backend returns { status: 'ready' | 'unsupported', scope, voices } where
 * voices is [{ id, label, languages? }]. Pure helpers here are unit-tested;
 * VoiceDiscoveryField.vue owns the fetch lifecycle.
 */

export type VoiceScope = 'account' | 'custom' | 'none' | 'public'

export interface VoiceChoice {
  id: string
  label: string
  languages?: string[]
}

export interface VoiceDiscoveryResult {
  status: 'ready' | 'unsupported'
  scope: VoiceScope
  voices: VoiceChoice[]
}

export type VoiceDiscoveryPhase =
  | 'model-first'
  | 'loading'
  | 'failed'
  | 'unsupported'
  | 'empty'
  | 'custom'
  | 'account'
  | 'public'

export interface CatalogModel {
  id?: string
  name?: string
  model?: string
  provider_ref?: ProviderRef
  [key: string]: unknown
}

export interface ProviderRef {
  connection_id?: string
  service?: string
  profile_id?: string
  binding?: string
  default_base_url?: string
}

export interface CatalogProfile {
  id?: string
  name?: string
  models?: CatalogModel[]
  connection_id?: string
  provider_ref?: ProviderRef
  [key: string]: unknown
}

export interface CatalogConnection {
  id?: string
  [key: string]: unknown
}

export interface CatalogShape {
  services?: Record<string, { profiles?: CatalogProfile[] } | undefined>
  connections?: CatalogConnection[]
  [key: string]: unknown
}

/** Profile keys that describe presentation, not the speech connection. */
const PROFILE_FINGERPRINT_OMIT = new Set(['models', 'name'])

const CONNECTION_CREDENTIAL_KEYS = [
  'provider',
  'binding',
  'api_key',
  'base_url',
  'api_version',
  'app_id',
  'extra_headers',
  'api_format',
  'wire_api',
  'proxy',
  'service_overrides',
] as const

function omit(record: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!keys.has(key)) out[key] = value
  }
  return out
}

function isProviderRef(value: unknown): value is ProviderRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as Record<string, unknown>
  return (
    typeof ref.connection_id === 'string' ||
    typeof ref.profile_id === 'string' ||
    typeof ref.service === 'string' ||
    typeof ref.binding === 'string'
  )
}

/**
 * Resolve the provider reference for a model, mirroring modelProviderRef:
 * model.provider_ref → profile.provider_ref → connection_id → self profile.
 */
function resolveProviderRef(profile: CatalogProfile, model?: CatalogModel): ProviderRef {
  if (isProviderRef(model?.provider_ref)) return model.provider_ref as ProviderRef
  if (isProviderRef(profile.provider_ref)) return profile.provider_ref as ProviderRef
  if (typeof profile.connection_id === 'string') {
    return { connection_id: profile.connection_id }
  }
  return { service: 'tts', profile_id: String(profile.id ?? '') }
}

function findRegistrySource(
  catalog: CatalogShape | null | undefined,
  profile: CatalogProfile,
  model: CatalogModel | undefined,
): CatalogConnection | CatalogProfile | undefined {
  if (!catalog) return undefined
  const ref = resolveProviderRef(profile, model)
  if (typeof ref.connection_id === 'string') {
    return catalog.connections?.find(item => item.id === ref.connection_id)
  }
  if (typeof ref.profile_id === 'string') {
    return catalog.services?.[ref.service ?? 'tts']?.profiles?.find(
      item => item.id === ref.profile_id,
    )
  }
  return undefined
}

/**
 * Stable identity of the TTS connection used for a model. Mirrors the React
 * modelTestFingerprint over the VoiceDiscoveryField snapshot (whose model is
 * reduced to { id, name, model, provider_ref }, then name is dropped again),
 * so changing the selected voice or cosmetic fields never starts another
 * account lookup, while credential/base_url/model identity changes do.
 */
export function voiceLookupFingerprint(
  catalog: CatalogShape | null | undefined,
  profileId: string,
  modelId: string,
): string {
  const profile = catalog?.services?.tts?.profiles?.find(item => item.id === profileId)
  const model = profile?.models?.find(item => item.id === modelId)

  // Element 1: profile connection minus its models and display name.
  const connection = profile
    ? omit(profile as Record<string, unknown>, PROFILE_FINGERPRINT_OMIT)
    : {}

  // Element 2: only the model identity survives (voice edits are excluded).
  const requestModel = model
    ? {
        id: model.id,
        model: model.model,
        ...(isProviderRef(model.provider_ref) ? { provider_ref: model.provider_ref } : {}),
      }
    : {}

  // Element 3: credential slice of the resolved provider source.
  const source = profile ? findRegistrySource(catalog, profile, model) : undefined
  const credentials = source
    ? Object.fromEntries(
        CONNECTION_CREDENTIAL_KEYS.map(key => [key, (source as Record<string, unknown>)[key]]),
      )
    : undefined

  // Element 4: the connection linked directly by profile.connection_id.
  const linkedConnection =
    typeof profile?.connection_id === 'string'
      ? catalog?.connections?.find(item => item.id === profile.connection_id)
      : undefined

  return JSON.stringify([connection, requestModel, credentials, linkedConnection])
}

/** A model without a concrete provider model id cannot be probed yet. */
export function hasSpeechModel(
  catalog: CatalogShape | null | undefined,
  profileId: string,
  modelId: string,
): boolean {
  const model = catalog?.services?.tts?.profiles
    ?.find(profile => profile.id === profileId)
    ?.models?.find(item => item.id === modelId)
  return typeof model?.model === 'string' && model.model.trim().length > 0
}

/**
 * Narrow an untrusted fetch payload to the documented discovery contract.
 * Returns null instead of throwing so the component can show its failed state.
 */
export function parseVoiceDiscovery(payload: unknown): VoiceDiscoveryResult | null {
  if (!payload || typeof payload !== 'object') return null
  const data = payload as Record<string, unknown>
  if (data.status !== 'ready' && data.status !== 'unsupported') return null
  if (!Array.isArray(data.voices)) return null
  const scope = typeof data.scope === 'string' ? (data.scope as VoiceScope) : 'none'
  const voices: VoiceChoice[] = []
  for (const row of data.voices) {
    if (!row || typeof row !== 'object') continue
    const candidate = row as Record<string, unknown>
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) continue
    const label =
      typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label
        : candidate.id
    const languages = Array.isArray(candidate.languages)
      ? candidate.languages.filter((item): item is string => typeof item === 'string')
      : undefined
    voices.push({ id: candidate.id, label, ...(languages ? { languages } : {}) })
  }
  return { status: data.status, scope, voices }
}

/** Whether the currently selected voice is part of a fresh discovery result. */
export function isListedVoice(result: VoiceDiscoveryResult | null, value: string): boolean {
  if (!result || !value) return false
  return result.voices.some(voice => voice.id === value)
}

/** Map the lookup state machine to the Chinese status copy used by the React app. */
export function voiceDiscoveryStatus(phase: VoiceDiscoveryPhase): string {
  switch (phase) {
    case 'model-first':
      return '请先选择模型，再获取音色。'
    case 'loading':
      return '正在获取音色…'
    case 'failed':
      return '音色获取失败，请检查提供方连接和权限后重试。'
    case 'unsupported':
      return '当前提供方或模型不支持通过此连接自动获取音色。可填写提供方提供的音色 ID；系统不会使用内置音色表。'
    case 'empty':
      return '提供方未返回适用于当前选择的音色。'
    case 'custom':
      return '已实时获取适用于该模型的自定义音色。此接口不返回系统音色，请试听后再应用。'
    case 'public':
      return '已实时获取公开音色列表，请试听确认兼容性后再应用。'
    case 'account':
    default:
      return '已实时获取账号音色。提供方未按模型筛选，请通过试听确认兼容性。'
  }
}

/** Resolve which status phase the UI should present. */
export function resolveDiscoveryPhase(input: {
  hasModel: boolean
  loading: boolean
  failed: boolean
  result: VoiceDiscoveryResult | null
}): VoiceDiscoveryPhase {
  if (!input.hasModel) return 'model-first'
  if (input.loading) return 'loading'
  if (input.failed) return 'failed'
  if (!input.result) return 'loading'
  if (input.result.status === 'unsupported') return 'unsupported'
  if (input.result.voices.length === 0) return 'empty'
  if (input.result.scope === 'custom') return 'custom'
  if (input.result.scope === 'public') return 'public'
  return 'account'
}
