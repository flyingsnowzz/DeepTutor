import { describe, expect, it } from 'vitest'
import { parseRuntimeStatusPayload } from '../runtimeStatusPayload'

const valid = {
  worker_id: 'worker-1', worker_count: 2, coordination_mode: 'redis',
  redis_configured: true, redis_status: 'ok', leader_id: 'worker-1', leader_healthy: true,
  owner_turn_count: 3, recovery_backlog: 0, lease_ttl_seconds: 30,
  renew_interval_seconds: 10, recovery_interval_seconds: 5,
}

describe('parseRuntimeStatusPayload', () => {
  it('accepts the runtime envelope and supplies protocol defaults', () => {
    expect(parseRuntimeStatusPayload({ runtime_status: valid })).toMatchObject({ worker_id: 'worker-1', protocol_version: '2.0' })
  })

  it('rejects credential-like fields anywhere in the response', () => {
    expect(() => parseRuntimeStatusPayload({ runtime_status: { ...valid, nested: { redis_url: 'private' } } })).toThrow(/credential-like/)
  })

  it('rejects missing required diagnostics', () => {
    expect(() => parseRuntimeStatusPayload({ runtime_status: { ...valid, worker_id: '' } })).toThrow(/worker_id/)
  })
})
