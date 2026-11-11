import { describe, expect, it } from 'vitest'
import {
  authoritativeResearchReport,
  buildDeepResearchPresentation,
  extractResearchOutlinePreview,
  isConfirmedResearchFollowup,
  normalizeDeepResearchReportFormatting,
  researchFollowupStatus,
  shouldReturnToChatAfterResearch,
} from '../deepResearchReport'

const outlineEvent = {
  type: 'result',
  metadata: {
    outline_preview: true,
    topic: 'Transformer',
    sub_topics: [
      { title: ' 注意力 ', overview: ' 机制 ' },
      { title: ' ', overview: 'dropped' },
    ],
    research_config: { mode: 'report', depth: 'deep' },
  },
}

const completeReport = [
  '# Report',
  '## 1. Intro',
  '## 2. Body',
  '## 3. Conclusion',
  'Done。',
].join('\n')

describe('deep research report presentation', () => {
  it('extracts and normalizes an outline preview', () => {
    const preview = extractResearchOutlinePreview({
      role: 'assistant',
      capability: 'deep_research',
      events: [outlineEvent],
    })
    expect(preview).toEqual({
      subTopics: [{ title: '注意力', overview: '机制' }],
      topic: 'Transformer',
      researchConfig: { mode: 'report', depth: 'deep' },
    })
  })

  it('ignores non-research messages and non-preview results', () => {
    expect(extractResearchOutlinePreview({ role: 'assistant', events: [outlineEvent] })).toBeNull()
    expect(
      extractResearchOutlinePreview({
        role: 'assistant',
        capability: 'deep_research',
        events: [{ type: 'result', metadata: { response: 'x' } }],
      }),
    ).toBeNull()
  })

  it('identifies confirmed research follow-ups without treating a new outline as one', () => {
    expect(isConfirmedResearchFollowup([{ stage: 'researching' }])).toBe(true)
    expect(isConfirmedResearchFollowup([{ stage: 'reporting' }])).toBe(true)
    expect(isConfirmedResearchFollowup([outlineEvent, { stage: 'researching' }])).toBe(false)
    expect(isConfirmedResearchFollowup([])).toBe(false)
  })

  it('normalizes spacing between the title and numbered report sections', () => {
    expect(normalizeDeepResearchReportFormatting('# Title## 1. First')).toBe(
      '# Title\n\n## 1. First',
    )
  })

  it('prefers the latest non-outline result response as the report', () => {
    const report = authoritativeResearchReport(
      [
        outlineEvent,
        { type: 'result', metadata: { response: completeReport } },
      ],
      'fallback',
    )
    expect(report.startsWith('# Report\n## 1.')).toBe(true)
    expect(authoritativeResearchReport([], 'fallback')).toBe('fallback')
  })

  it('derives follow-up status from done metadata and report structure', () => {
    expect(researchFollowupStatus([{ stage: 'researching' }])).toBe('researching')
    expect(
      researchFollowupStatus([
        { stage: 'researching' },
        { type: 'done', metadata: { status: 'failed' } },
      ]),
    ).toBe('failed')
    expect(
      researchFollowupStatus([
        { stage: 'researching' },
        { type: 'result', metadata: { response: completeReport } },
        { type: 'done', metadata: { status: 'completed' } },
      ]),
    ).toBe('done')
    expect(
      researchFollowupStatus([
        { type: 'result', metadata: { response: '# Incomplete' } },
        { type: 'done', metadata: { status: 'completed' } },
      ]),
    ).toBe('failed')
  })

  it('merges outline and report assistant messages while dropping the follow-up row', () => {
    const parent = {
      role: 'assistant',
      capability: 'deep_research',
      content: 'preface',
      events: [outlineEvent],
    }
    const followup = {
      role: 'assistant',
      capability: 'deep_research',
      content: 'old',
      events: [
        { stage: 'researching' },
        { type: 'result', metadata: { response: completeReport } },
        { type: 'done', metadata: { status: 'completed' } },
      ],
    }
    const presentation = buildDeepResearchPresentation([parent, followup])
    expect([...presentation.followupIndices]).toEqual([1])
    expect(presentation.statusByParent.get(0)).toBe('done')
    expect(presentation.mergedByParent.get(0)?.mergedContent).toContain('## 3. Conclusion')
    expect(presentation.mergedByParent.get(0)?.mergedEvents).toHaveLength(4)
  })

  it('keeps an unconfirmed outline editable and tells when research should return to chat', () => {
    const presentation = buildDeepResearchPresentation([
      { role: 'assistant', capability: 'deep_research', events: [outlineEvent] },
    ])
    expect(presentation.statusByParent.get(0)).toBe('editing')
    expect(shouldReturnToChatAfterResearch([{ stage: 'researching' }])).toBe(false)
    expect(
      shouldReturnToChatAfterResearch([
        { stage: 'reporting' },
        { type: 'done', metadata: { status: 'completed' } },
      ]),
    ).toBe(true)
  })
})
