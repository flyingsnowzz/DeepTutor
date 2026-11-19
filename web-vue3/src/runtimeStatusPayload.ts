export interface RuntimeStatusPayload {
  worker_id: string
  worker_count: number
  coordination_mode: 'memory' | 'redis'
  redis_configured: boolean
  redis_status: 'ok' | 'unavailable' | 'not_configured'
  leader_id: string | null
  leader_healthy: boolean | null
  owner_turn_count: number
  recovery_backlog: number
  lease_ttl_seconds: number
  renew_interval_seconds: number
  recovery_interval_seconds: number
  protocol_version: string
  minimum_web_protocol_version: string
}

const secretKey = /(?:password|passwd|secret|token|credential|api[_-]?key|redis[_-]?url|dsn)/i

function containsCredentialKey(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(item => containsCredentialKey(item, seen))
  return Object.entries(value).some(([key, child]) => secretKey.test(key) || containsCredentialKey(child, seen))
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Runtime status must be an object')
  return value as Record<string, unknown>
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new TypeError(`Runtime status field ${field} is invalid`)
  return Number(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Runtime status field ${field} is invalid`)
  return value.trim()
}

export function parseRuntimeStatusPayload(raw: unknown): RuntimeStatusPayload {
  if (containsCredentialKey(raw)) throw new TypeError('Runtime status contained a credential-like field')
  const envelope = record(raw)
  const source = record(envelope.runtime_status ?? envelope)
  const coordination = source.coordination_mode
  const redis = source.redis_status
  if (coordination !== 'memory' && coordination !== 'redis') throw new TypeError('Runtime coordination mode is invalid')
  if (redis !== 'ok' && redis !== 'unavailable' && redis !== 'not_configured') throw new TypeError('Runtime Redis status is invalid')
  if (typeof source.redis_configured !== 'boolean') throw new TypeError('Runtime Redis configuration flag is invalid')
  if (source.leader_healthy != null && typeof source.leader_healthy !== 'boolean') throw new TypeError('Runtime leader health is invalid')
  return {
    worker_id: text(source.worker_id, 'worker_id'),
    worker_count: integer(source.worker_count, 'worker_count', 1),
    coordination_mode: coordination,
    redis_configured: source.redis_configured,
    redis_status: redis,
    leader_id: source.leader_id == null ? null : text(source.leader_id, 'leader_id'),
    leader_healthy: source.leader_healthy == null ? null : source.leader_healthy,
    owner_turn_count: integer(source.owner_turn_count ?? 0, 'owner_turn_count'),
    recovery_backlog: integer(source.recovery_backlog ?? 0, 'recovery_backlog'),
    lease_ttl_seconds: integer(source.lease_ttl_seconds, 'lease_ttl_seconds', 1),
    renew_interval_seconds: integer(source.renew_interval_seconds, 'renew_interval_seconds', 1),
    recovery_interval_seconds: integer(source.recovery_interval_seconds, 'recovery_interval_seconds', 1),
    protocol_version: text(source.protocol_version ?? '2.0', 'protocol_version'),
    minimum_web_protocol_version: text(source.minimum_web_protocol_version ?? '2.0', 'minimum_web_protocol_version'),
  }
}
