export interface BackendSystemSettings {
  backend_port?: number | string
  next_public_api_base?: string
  next_public_api_base_external?: string
}

export declare function resolveBackendOrigin(
  env?: Record<string, string | undefined>,
  settings?: BackendSystemSettings,
): string

export declare function loadBackendSettings(file?: URL | string): BackendSystemSettings
