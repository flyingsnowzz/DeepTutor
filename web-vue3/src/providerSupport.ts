export type ProviderServiceName =
  | 'llm'
  | 'task'
  | 'embedding'
  | 'search'
  | 'tts'
  | 'stt'
  | 'imagegen'
  | 'videogen'

export type ProviderServiceSupport = {
  enabled: boolean
  evidence: 'manual' | 'detected' | 'builtin' | 'unknown'
}

export const PROVIDER_SERVICES: ProviderServiceName[] = [
  'llm',
  'embedding',
  'tts',
  'stt',
  'imagegen',
  'videogen',
  'search',
]

type ProviderOption = {
  value: string
  status?: string
}

type ConnectionTarget = {
  provider: string
  services?: Record<string, unknown>
}

export function providerServiceSupport(
  source: { provider?: string; service?: string; source_service?: string; discovery?: any; service_overrides?: Record<string, any> },
  service: ProviderServiceName,
  targets: ConnectionTarget[] = [],
  providers: Partial<Record<ProviderServiceName, ProviderOption[]>> = {},
): ProviderServiceSupport {
  const kind = service === 'task' ? 'llm' : service
  const override = source.service_overrides?.[kind]
  if (override) return { enabled: Boolean(override.enabled), evidence: 'manual' }

  const detected = source.discovery?.status === 'connected'
    && source.discovery.capabilities?.some((item: any) => item.category === kind && item.evidence === 'metadata')
  const sourceService = source.service || source.source_service
  const provider = source.provider || 'custom'
  const known = Boolean(
    (provider !== 'custom' && targets.find(target => target.provider === provider)?.services?.[kind])
    || providers[kind]?.some(option =>
      option.value === provider
      && (provider !== 'custom' || kind === 'llm')
      && option.value !== 'none'
      && option.status !== 'deprecated'),
  ) || (sourceService === 'task' ? 'llm' : sourceService) === kind

  return {
    enabled: known || Boolean(detected && kind !== 'search'),
    evidence: detected ? 'detected' : known ? 'builtin' : 'unknown',
  }
}

export function providerAdapter(
  source: { provider?: string; service?: string; source_service?: string; service_overrides?: Record<string, any> },
  service: ProviderServiceName,
  targets: ConnectionTarget[] = [],
  providers: Partial<Record<ProviderServiceName, ProviderOption[]>> = {},
): { binding: string; defaultBaseUrl: string } {
  const kind = service === 'task' ? 'llm' : service
  const override = source.service_overrides?.[kind]
  const provider = source.provider || 'custom'
  const target = targets.find(item => item.provider === source.provider)?.services?.[kind] as
    | { provider?: string; base_url?: string }
    | undefined
  const exact = providers[service]?.find(option => option.value === provider)
  const binding = (override?.enabled && override.binding)
    || target?.provider
    || exact?.value
    || (service === 'llm' || service === 'task' || service === 'search' || (source.service || source.source_service) === service
      ? provider
      : 'custom')

  return {
    binding,
    defaultBaseUrl: (override?.enabled && override.base_url) || target?.base_url || '',
  }
}
