/** Request-input signature for one model test. Never persist it: it may include credentials. */
export function modelTestFingerprint(
  catalog: Record<string, any>,
  service: string,
  profileId: string,
  modelId?: string | null,
): string {
  const profile = catalog.services?.[service]?.profiles?.find((item: { id: string }) => item.id === profileId)
  const model = profile?.models?.find((item: { id: string }) => item.id === modelId)
  const { models: _models, name: _profileName, ...connection } = profile ?? {}
  const {
    name: _modelName,
    context_window: _window,
    context_window_tokens: _legacyWindow,
    context_window_source: _source,
    context_window_detected_at: _date,
    dimension: _dimension,
    supported_dimensions: _dimensions,
    ...requestModel
  } = model ?? {}
  const providerRef = model?.provider_ref || profile?.provider_ref || (profile?.connection_id
    ? { connection_id: profile.connection_id }
    : { service, profile_id: profileId })
  const providerSource = providerRef.connection_id
    ? catalog.connections?.find((item: { id: string }) => item.id === providerRef.connection_id)
    : catalog.services?.[providerRef.service]?.profiles?.find((item: { id: string }) => item.id === providerRef.profile_id)
  const credentials = providerSource ? Object.fromEntries([
    'provider', 'binding', 'api_key', 'base_url', 'api_version', 'app_id',
    'extra_headers', 'api_format', 'wire_api', 'proxy', 'service_overrides',
  ].map(key => [key, providerSource[key]])) : undefined
  return JSON.stringify([
    connection,
    requestModel,
    credentials,
    catalog.connections?.find((item: { id: string }) => item.id === profile?.connection_id),
  ])
}
