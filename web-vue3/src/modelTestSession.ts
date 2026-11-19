import { reactive, type InjectionKey } from 'vue'

export interface ModelTestResult {
  state: 'running' | 'success' | 'failed'
  fingerprint: string
  message: string
  logs: string
  responseSnippet: string
  context: { value: number; source: string; detectedAt?: string } | null
  dimension: number | null
  supportedDimensions: number[]
}

export function modelTestKey(service: string, profileId: string, modelId?: string | null): string {
  return JSON.stringify([service, profileId, modelId ?? null])
}

export function createModelTestSession() {
  const state = reactive({ results: {} as Record<string, ModelTestResult>, runningKey: null as string | null })
  let source: EventSource | null = null
  let disposed = false
  return {
    state,
    begin(key: string, result: ModelTestResult) {
      if (disposed || state.runningKey) return false
      state.runningKey = key
      state.results[key] = result
      return true
    },
    update(key: string, patch: Partial<ModelTestResult>) {
      if (!disposed && state.results[key]) Object.assign(state.results[key], patch)
    },
    attach(next: EventSource) {
      if (disposed || !state.runningKey) { next.close(); return false }
      source = next
      return true
    },
    finish(key: string, patch: Pick<ModelTestResult, 'state' | 'message'>) {
      if (disposed || state.runningKey !== key) return false
      Object.assign(state.results[key], patch)
      state.runningKey = null
      source?.close()
      source = null
      return true
    },
    dispose() {
      disposed = true
      source?.close()
      source = null
      state.runningKey = null
    },
  }
}

export type ModelTestSession = ReturnType<typeof createModelTestSession>
export const modelTestSessionKey: InjectionKey<ModelTestSession> = Symbol('modelTestSession')
