export type ContextBudgetSegment = { key: string; tokens: number }
export interface ContextBudget { window: number; window_estimated?: boolean; used_tokens: number; free_tokens: number; model?: string; counter?: string; deferred_tool_count?: number; segments: ContextBudgetSegment[] }
interface BudgetEvent { type: string; metadata?: Record<string, unknown> }
export function readContextBudget(events?: BudgetEvent[]): ContextBudget | null {
  if (!events) return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'result') continue
    const meta = event.metadata?.metadata as Record<string, unknown> | undefined
    const budget = meta?.context_budget as ContextBudget | undefined
    if (budget && typeof budget.window === 'number' && typeof budget.used_tokens === 'number' && Array.isArray(budget.segments)) return budget
  }
  return null
}
export function latestContextBudget(messages: Array<{ role: string; events?: BudgetEvent[] }>): ContextBudget | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'assistant') continue
    const budget = readContextBudget(messages[index].events)
    if (budget) return budget
  }
  return null
}
