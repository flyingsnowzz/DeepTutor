export interface LLMSelection {
  profile_id: string
  model_id: string
}

export interface LLMOption extends LLMSelection {
  profile_name: string
  model_name: string
  model?: string
  provider?: string
  provider_label?: string
  context_window?: number
  reasoning_effort?: string
  supported_reasoning_efforts?: string[]
  supports_vision?: boolean
  is_active_default?: boolean
}

export interface LLMOptionsResponse {
  active: LLMSelection | null
  options: LLMOption[]
}

export function llmSelectionKey(selection: LLMSelection | null | undefined): string {
  if (!selection?.profile_id || !selection.model_id) return ''
  return `${selection.profile_id}:${selection.model_id}`
}

export function sameLLMSelection(
  left: LLMSelection | null | undefined,
  right: LLMSelection | null | undefined,
): boolean {
  return llmSelectionKey(left) === llmSelectionKey(right)
}
