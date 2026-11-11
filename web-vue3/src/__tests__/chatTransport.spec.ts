import { describe, expect, it } from 'vitest'
import {
  buildResumeTurn,
  clampChatResponseTimeout,
  decideIdleTurnRecovery,
  readStoredChatResponseTimeout,
  reconnectDelay,
  resolveLoadedRunStatus,
  shouldReconnect,
  writeStoredChatResponseTimeout,
} from '../chatTransport'

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
  }
}

describe('reconnectDelay', () => {
  it('uses exponential backoff capped at 8s with ±20% jitter', () => {
    expect(reconnectDelay(0, () => 0.5)).toBe(Math.round(250 * 1.0))
    expect(reconnectDelay(1, () => 0.5)).toBe(Math.round(500 * 1.0))
    // Jitter range for attempt 0 is 200–300.
    expect(reconnectDelay(0, () => 0)).toBe(200)
    expect(reconnectDelay(0, () => 1)).toBe(300)
    // High attempts clamp to 8000 before jitter.
    expect(reconnectDelay(20, () => 0.5)).toBe(8000)
  })
})

describe('shouldReconnect', () => {
  it('stops retrying on a hidden tab without an active turn', () => {
    expect(shouldReconnect({ attempt: 1, activeTurnId: null, pageVisible: false })).toBe(false)
  })
  it('retries indefinitely while a turn is active, even on a hidden tab', () => {
    expect(shouldReconnect({ attempt: 99, activeTurnId: 'turn-1', pageVisible: false })).toBe(true)
  })
  it('gives up after 5 idle attempts when visible but no turn is active', () => {
    expect(shouldReconnect({ attempt: 4, activeTurnId: null, pageVisible: true })).toBe(true)
    expect(shouldReconnect({ attempt: 5, activeTurnId: null, pageVisible: true })).toBe(false)
  })
})

describe('decideIdleTurnRecovery', () => {
  const base = {
    isStreaming: true,
    hasPendingUserInput: false,
    activeTurnId: 'turn-1',
    lastSeq: 7,
    updatedAt: 1000,
    now: 200_000,
    idleTimeoutMs: 180_000,
  }
  it('does nothing when not streaming or input is pending', () => {
    expect(decideIdleTurnRecovery({ ...base, isStreaming: false }).kind).toBe('none')
    expect(decideIdleTurnRecovery({ ...base, hasPendingUserInput: true }).kind).toBe('none')
  })
  it('does nothing within the idle window', () => {
    expect(decideIdleTurnRecovery({ ...base, now: 1000 + 100_000 }).kind).toBe('none')
  })
  it('re-subscribes from the last sequence when a turn id is known', () => {
    const decision = decideIdleTurnRecovery(base)
    expect(decision).toEqual({ kind: 'resubscribe', turnId: 'turn-1', afterSeq: 7 })
  })
  it('falls back to reconcile when no turn id is known', () => {
    expect(decideIdleTurnRecovery({ ...base, activeTurnId: null }).kind).toBe('reconcile')
  })
})

describe('resolveLoadedRunStatus', () => {
  it('treats a fresh running turn as live and a stale one as idle', () => {
    expect(resolveLoadedRunStatus('running', 1000, 5000, 180_000)).toBe('running')
    expect(resolveLoadedRunStatus('running', 1000, 200_000, 180_000)).toBe('idle')
    expect(resolveLoadedRunStatus('completed', 1000, 200_000, 180_000)).toBe('completed')
  })
})

describe('buildResumeTurn', () => {
  it('matches the resume_from wire contract', () => {
    expect(buildResumeTurn('turn-9', 3)).toEqual({
      type: 'resume_from', turn_id: 'turn-9', seq: 3, protocol_version: '2.0',
    })
  })
})

describe('chat response timeout storage', () => {
  it('clamps to the 30–1800s bounds and defaults to 180', () => {
    expect(clampChatResponseTimeout(5)).toBe(30)
    expect(clampChatResponseTimeout(99999)).toBe(1800)
    expect(clampChatResponseTimeout(Number.NaN)).toBe(180)
  })
  it('round-trips through the deeptutor.chatResponseTimeout mirror', () => {
    const storage = memoryStorage()
    writeStoredChatResponseTimeout(240, storage)
    expect(storage.getItem('deeptutor.chatResponseTimeout')).toBe('240')
    expect(readStoredChatResponseTimeout(storage)).toBe(240)
  })
  it('falls back to 180 when the mirror is missing or corrupt', () => {
    expect(readStoredChatResponseTimeout(memoryStorage())).toBe(180)
    expect(readStoredChatResponseTimeout(memoryStorage({ 'deeptutor.chatResponseTimeout': 'garbage' }))).toBe(180)
  })
})
