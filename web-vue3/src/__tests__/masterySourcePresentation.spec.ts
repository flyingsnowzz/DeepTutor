import { describe, expect, it } from 'vitest'
import { presentedSourcePages } from '../masterySourcePresentation'

describe('mastery source presentation', () => {
  it('only accepts teaching/reveal pages on the exact authenticated source route', () => {
    const preview = '/api/knowledge-bases/course/source-page?document=lecture.pdf&page=7&digest=abc'
    expect(presentedSourcePages([{
      type: 'sources',
      source: 'chat',
      metadata: {
        sources: [
          { title: 'Page', preview_url: preview, presentation: 'teaching' },
          { title: 'Hidden', preview_url: '/api/private', presentation: 'teaching' },
          { title: 'Denied', preview_url: preview, presentation: 'denied' },
        ],
      },
    }])).toEqual([{ title: 'Page', preview_url: preview }])
    expect(presentedSourcePages([{ type: 'sources', source: 'other', metadata: { sources: [] } }])).toEqual([])
  })
})
