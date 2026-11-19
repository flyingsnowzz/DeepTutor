import { beforeEach, describe, expect, it } from 'vitest'
import { currentDiagnosticsResult, readDiagnosticsResults, saveDiagnosticsResult } from '../settingsDiagnostics'

describe('settings diagnostics', () => {
  beforeEach(() => sessionStorage.clear())

  it('shares the last test result across settings pages for the same selection', () => {
    saveDiagnosticsResult('llm', { state: 'failed', message: 'timeout', profileId: 'provider-a', modelId: 'model-a' })
    const results = readDiagnosticsResults()
    const catalog = { services: { llm: { active_profile_id: 'provider-a', active_model_id: 'model-a' } } }
    expect(currentDiagnosticsResult(catalog, 'llm', results)?.state).toBe('failed')
    catalog.services.llm.active_model_id = 'model-b'
    expect(currentDiagnosticsResult(catalog, 'llm', results)).toBeNull()
  })

  it('uses a null model id for search and preserves results from other services', () => {
    saveDiagnosticsResult('llm', { state: 'success', message: 'ok', profileId: 'provider-a', modelId: 'model-a' })
    saveDiagnosticsResult('search', { state: 'failed', message: 'timeout', profileId: 'search-a', modelId: null })
    expect(Object.keys(readDiagnosticsResults())).toEqual(['llm', 'search'])
    expect(currentDiagnosticsResult({ services: { search: { active_profile_id: 'search-a' } } }, 'search', readDiagnosticsResults())?.state).toBe('failed')
  })
})
