/**
 * Chat transport resilience — Vue3 port of:
 *  - web/features/chat/transport/reconnect-policy.ts
 *  - web/lib/chat-idle-recovery.ts
 *
 * Pure functions only; ChatPage owns the WebSocket and calls these to decide
 * reconnect timing, gating, and idle watchdog actions.
 */

const BASE_DELAY_MS = 250
const MAX_DELAY_MS = 8_000
const IDLE_ATTEMPT_LIMIT = 5
const DEFAULT_RESPONSE_TIMEOUT_S = 180

/** Exponential backoff with ±20% jitter, capped at 8s. Mirrors reconnectDelay(). */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt))
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4
  return Math.round(exponential * jitter)
}

/**
 * Whether another reconnect attempt is warranted.
 * A hidden tab with no active turn stops retrying; an active turn retries
 * indefinitely, otherwise give up after IDLE_ATTEMPT_LIMIT attempts.
 */
export function shouldReconnect(input: {
  attempt: number
  activeTurnId: string | null
  pageVisible: boolean
}): boolean {
  if (!input.pageVisible && !input.activeTurnId) return false
  return Boolean(input.activeTurnId) || input.attempt < IDLE_ATTEMPT_LIMIT
}

export type IdleTurnRecoveryDecision =
  | { kind: 'none' }
  | { kind: 'resubscribe'; turnId: string; afterSeq: number }
  | { kind: 'reconcile' }

export interface IdleTurnRecoveryInput {
  isStreaming: boolean
  hasPendingUserInput: boolean
  activeTurnId: string | null
  lastSeq: number
  updatedAt: number
  now: number
  idleTimeoutMs: number
}

/**
 * Decide what the idle watchdog should do when a streaming turn goes quiet.
 * A quiet socket is not proof of failure — long research calls can be silent
 * for minutes. With a known turn id, re-subscribe from the last sequence so
 * the backend replays buffered events (including a missed terminal event).
 */
export function decideIdleTurnRecovery(input: IdleTurnRecoveryInput): IdleTurnRecoveryDecision {
  if (!input.isStreaming || input.hasPendingUserInput) return { kind: 'none' }
  if (input.now - input.updatedAt <= input.idleTimeoutMs) return { kind: 'none' }
  if (!input.activeTurnId) return { kind: 'reconcile' }
  return { kind: 'resubscribe', turnId: input.activeTurnId, afterSeq: input.lastSeq }
}

/**
 * A `running` row older than the idle window is stale bookkeeping from a
 * crashed/restarted backend, not a live turn — surface it as idle so the
 * composer does not get stuck showing Stop.
 */
export function resolveLoadedRunStatus<T extends string>(
  status: T,
  lastActivityAt: number,
  now: number,
  idleTimeoutMs: number,
): T | 'idle' {
  if (status !== 'running') return status
  if (now - lastActivityAt <= idleTimeoutMs) return status
  return 'idle'
}

/** Build the resume_from wire command, matching buildResumeTurn() contract. */
export function buildResumeTurn(turnId: string, afterSeq = 0): Record<string, unknown> {
  return { type: 'resume_from', turn_id: turnId, seq: afterSeq, protocol_version: '2.0' }
}

const CHAT_RESPONSE_TIMEOUT_STORAGE_KEY = 'deeptutor.chatResponseTimeout'
const MIN_CHAT_RESPONSE_TIMEOUT_SECONDS = 30
const MAX_CHAT_RESPONSE_TIMEOUT_SECONDS = 1800

/** Clamp to the same bounds the backend/settings enforce (app-shell-storage parity). */
export function clampChatResponseTimeout(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_RESPONSE_TIMEOUT_S
  return Math.min(MAX_CHAT_RESPONSE_TIMEOUT_SECONDS, Math.max(MIN_CHAT_RESPONSE_TIMEOUT_SECONDS, Math.round(seconds)))
}

/**
 * Read the configured chat response timeout from its localStorage mirror.
 * The setting is cached as a plain integer string (key deeptutor.chatResponseTimeout)
 * so the chat watchdog can read it synchronously without its own fetch.
 */
export function readStoredChatResponseTimeout(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): number {
  try {
    const raw = storage?.getItem(CHAT_RESPONSE_TIMEOUT_STORAGE_KEY)
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 ? clampChatResponseTimeout(parsed) : DEFAULT_RESPONSE_TIMEOUT_S
  } catch {
    return DEFAULT_RESPONSE_TIMEOUT_S
  }
}

/** Mirror the per-user chat_response_timeout UI preference for the watchdog. */
export function writeStoredChatResponseTimeout(
  seconds: number,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): void {
  try {
    storage?.setItem(CHAT_RESPONSE_TIMEOUT_STORAGE_KEY, String(clampChatResponseTimeout(seconds)))
  } catch {
    // Storage can be disabled; the watchdog simply keeps its default window.
  }
}
