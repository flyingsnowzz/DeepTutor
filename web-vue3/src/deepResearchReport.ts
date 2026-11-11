/**
 * Deep-research two-turn message presentation, ported from
 * web/lib/deep-research-report.ts and the merge logic in ChatMessageList.
 */
import type { OutlineItem } from './research'
import { normalizeOutline } from './research'

export type DeepResearchStatus = 'editing' | 'researching' | 'done' | 'failed'
export type DeepResearchFollowupStatus = 'researching' | 'done' | 'failed'

export type ResearchEvent = {
  type?: string
  stage?: string
  status?: string
  metadata?: Record<string, unknown>
}

export type ResearchMessage = {
  role?: string
  capability?: string
  content?: string
  events?: ResearchEvent[]
}

export interface ResearchOutlinePreview {
  subTopics: OutlineItem[]
  topic: string
  researchConfig: Record<string, unknown> | null
}

export interface MergedResearchMessage<T extends ResearchMessage> {
  message: T
  mergedEvents: ResearchEvent[]
  mergedContent: string
}

function eventMetadata(event: ResearchEvent | undefined): Record<string, unknown> {
  return event?.metadata ?? {}
}

function resultEvent(message: ResearchMessage): ResearchEvent | undefined {
  return message.events?.find(event => event.type === 'result')
}

/** Extract the first-turn outline-preview result carried by a research message. */
export function extractResearchOutlinePreview(message: ResearchMessage): ResearchOutlinePreview | null {
  const event = resultEvent(message)
  if (!event || message.capability !== 'deep_research') return null
  const metadata = eventMetadata(event)
  if (metadata.outline_preview !== true) return null
  const rawTopics = metadata.sub_topics
  const subTopics = normalizeOutline(Array.isArray(rawTopics) ? (rawTopics as OutlineItem[]) : [])
  const researchConfig =
    metadata.research_config && typeof metadata.research_config === 'object'
      ? (metadata.research_config as Record<string, unknown>)
      : null
  return {
    subTopics,
    topic: String(metadata.topic ?? ''),
    researchConfig,
  }
}

export function isConfirmedResearchFollowup(events: ResearchEvent[] | undefined): boolean {
  if (!events?.length) return false
  if (
    events.some(
      event => event.type === 'result' && eventMetadata(event).outline_preview === true,
    )
  ) {
    return false
  }
  return events.some(event => event.stage === 'researching' || event.stage === 'reporting')
}

export function normalizeDeepResearchReportFormatting(content: string): string {
  if (!content) return content
  return content.replace(/^(# [^\r\n]*?)(?=##\s+\d+\.\s*)/, '$1\n\n')
}

export function authoritativeResearchReport(
  events: ResearchEvent[] | undefined,
  fallback: string,
): string {
  for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = events?.[index]
    if (!event || event.type !== 'result') continue
    const metadata = eventMetadata(event)
    if (metadata.outline_preview === true) continue
    const response = metadata.response
    if (typeof response === 'string' && response.trim()) {
      return normalizeDeepResearchReportFormatting(response)
    }
  }
  return normalizeDeepResearchReportFormatting(fallback)
}

function isStructurallyCompleteResearchReport(content: string): boolean {
  const normalized = normalizeDeepResearchReportFormatting(content).trim()
  if (!normalized) return false
  const numberedSections = normalized.match(/^##\s+\d+\.\s*\S/gm) ?? []
  if (numberedSections.length < 3) return false
  if (normalized.endsWith('</details>')) return true
  return /[.!?。！？)\]）】]$/.test(normalized)
}

export function researchFollowupStatus(
  events: ResearchEvent[] | undefined,
): DeepResearchFollowupStatus {
  const done = [...(events ?? [])].reverse().find(event => event.type === 'done')
  if (!done) return 'researching'
  const status = String(eventMetadata(done).status || 'completed')
  if (status !== 'completed') return 'failed'
  const response = authoritativeResearchReport(events, '')
  return isStructurallyCompleteResearchReport(response) ? 'done' : 'failed'
}

function nextResearchAssistant(messages: ResearchMessage[], fromIndex: number): ResearchMessage | undefined {
  return messages.slice(fromIndex + 1).find(
    message => message.role === 'assistant' && message.capability === 'deep_research',
  )
}

export interface DeepResearchPresentation {
  mergedByParent: Map<number, MergedResearchMessage<ResearchMessage>>
  followupIndices: Set<number>
  statusByParent: Map<number, DeepResearchStatus>
}

/** Build React-parity merge maps for deep-research outline + report pairs. */
export function buildDeepResearchPresentation(messages: ResearchMessage[]): DeepResearchPresentation {
  const mergedByParent = new Map<number, MergedResearchMessage<ResearchMessage>>()
  const followupIndices = new Set<number>()
  const statusByParent = new Map<number, DeepResearchStatus>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant' || message.capability !== 'deep_research') continue
    if (!extractResearchOutlinePreview(message)) continue

    const followup = nextResearchAssistant(messages, index)
    if (followup && isConfirmedResearchFollowup(followup.events)) {
      const followupIndex = messages.indexOf(followup, index + 1)
      followupIndices.add(followupIndex)
      const mergedEvents = [...(message.events ?? []), ...(followup.events ?? [])]
      mergedByParent.set(index, {
        message,
        mergedEvents,
        mergedContent: authoritativeResearchReport(
          followup.events,
          followup.content || message.content || '',
        ),
      })
      statusByParent.set(index, researchFollowupStatus(followup.events))
    } else {
      statusByParent.set(index, 'editing')
    }
  }

  return { mergedByParent, followupIndices, statusByParent }
}

export function shouldReturnToChatAfterResearch(events: ResearchEvent[] | undefined): boolean {
  if (!isConfirmedResearchFollowup(events)) return false
  return Boolean(events?.some(event => event.type === 'done'))
}
