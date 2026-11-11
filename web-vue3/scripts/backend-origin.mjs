import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DEFAULT_BACKEND_ORIGIN = 'http://127.0.0.1:8001'

export function resolveBackendOrigin(env = process.env, settings = {}) {
  if (env.DEEPTUTOR_API_ORIGIN) return env.DEEPTUTOR_API_ORIGIN
  if (env.DEEPTUTOR_API_BASE_URL) return env.DEEPTUTOR_API_BASE_URL
  if (env.BACKEND_PORT) return `http://127.0.0.1:${env.BACKEND_PORT}`
  if (env.NEXT_PUBLIC_API_BASE) return env.NEXT_PUBLIC_API_BASE
  if (settings.next_public_api_base) return settings.next_public_api_base
  if (settings.next_public_api_base_external) return settings.next_public_api_base_external
  if (settings.backend_port) return `http://127.0.0.1:${settings.backend_port}`
  return DEFAULT_BACKEND_ORIGIN
}

export function loadBackendSettings(file = new URL('../../data/user/settings/system.json', import.meta.url)) {
  try {
    return JSON.parse(readFileSync(fileURLToPath(file), 'utf8'))
  } catch {
    return {}
  }
}
