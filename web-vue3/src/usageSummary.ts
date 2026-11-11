export interface UsageSummary {
  total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; reasoning_tokens?: number; total_calls?: number; cache_write_reported_calls?: number; cache_reported_calls?: number; cache_input_tokens?: number; cache_hit_rate?: number | null; ttft_seconds?: number | null; ttft_calls?: number; duration_seconds?: number; generation_seconds?: number | null; timed_completion_tokens?: number; tokens_per_second?: number | null; estimated_calls?: number; call_details?: CallUsage[]
}
export interface CallUsage extends UsageSummary { model?: string; provider?: string; estimated?: boolean; status?: string }
interface UsageEvent { type: string; metadata?: Record<string, unknown> }
export function combineUsage(summaries: UsageSummary[]): UsageSummary {
  const sum = (key: keyof UsageSummary) => summaries.reduce((total, summary) => total + (typeof summary[key] === 'number' ? summary[key] as number : 0), 0)
  const cacheInput = sum('cache_input_tokens')
  const ttftCalls = sum('ttft_calls')
  const generation = sum('generation_seconds')
  return {
    total_tokens: sum('total_tokens'), prompt_tokens: sum('prompt_tokens'), completion_tokens: sum('completion_tokens'), total_calls: sum('total_calls'), cache_read_input_tokens: sum('cache_read_input_tokens'), cache_creation_input_tokens: sum('cache_creation_input_tokens'), reasoning_tokens: sum('reasoning_tokens'), cache_input_tokens: cacheInput, cache_reported_calls: sum('cache_reported_calls'),
    cache_write_reported_calls: summaries.reduce((total, summary) => total + (summary.cache_write_reported_calls ?? summary.call_details?.filter(call => call.cache_creation_input_tokens != null).length ?? 0), 0),
    cache_hit_rate: cacheInput ? sum('cache_read_input_tokens') / cacheInput : null, ttft_calls: ttftCalls,
    ttft_seconds: ttftCalls ? summaries.reduce((total, summary) => total + (summary.ttft_seconds ?? 0) * (summary.ttft_calls ?? 0), 0) / ttftCalls : null,
    duration_seconds: sum('duration_seconds'), generation_seconds: generation, timed_completion_tokens: sum('timed_completion_tokens'), tokens_per_second: generation ? sum('timed_completion_tokens') / generation : null, estimated_calls: sum('estimated_calls'), call_details: summaries.flatMap(summary => summary.call_details ?? []),
  }
}
export function messageUsage(events?: UsageEvent[]): UsageSummary | null {
  const turns: UsageSummary[] = []
  let pending: UsageSummary | null = null
  for (const event of events || []) {
    if (event.type === 'result') {
      const payload = event.metadata?.metadata as Record<string, unknown> | undefined
      const value = payload?.usage_summary ?? payload?.cost_summary
      if (value && typeof value === 'object') pending = value as UsageSummary
    }
    if (event.type === 'done') {
      const value = event.metadata?.usage_summary as UsageSummary | undefined
      if (value || pending) turns.push(value || pending!)
      pending = null
    }
  }
  if (pending) turns.push(pending)
  return turns.length ? combineUsage(turns) : null
}
export function cumulativeMessageUsage(messages: Array<{ role: string; events?: UsageEvent[] }>): UsageSummary[] {
  let running: UsageSummary = {}
  return messages.map(message => {
    const usage = message.role === 'assistant' ? messageUsage(message.events) : null
    if (usage) running = { ...combineUsage([running, usage]), call_details: [] }
    return running
  })
}
