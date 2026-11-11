import { describe, expect, it } from 'vitest'
import { extractVideoLessonResult, videoLessonFromMessage } from '../videoLesson'

const url = '/files/outputs/workspace/chat/video_lesson/turn-1/artifacts/lesson.html'
const metadata = {
  title: 'Calculus',
  response: 'Summary',
  artifacts: [{ type: 'html', url, filename: 'lesson.html', label: 'Calculus' }],
  code: { language: 'tsx', content: 'export const Lesson = () => null' },
  render: {
    duration_seconds: 90,
    attempts: [{ stage: 'render_check', errors: [] }],
    narrated: true,
  },
}

describe('video lesson extraction', () => {
  it('extracts the playable HTML artifact, code, duration and attempt count', () => {
    expect(extractVideoLessonResult(metadata)).toEqual({
      response: 'Summary',
      title: 'Calculus',
      page: metadata.artifacts[0],
      code: 'export const Lesson = () => null',
      durationSeconds: 90,
      attempts: 1,
    })
  })

  it('falls back to the artifact label and null duration for malformed render data', () => {
    expect(
      extractVideoLessonResult({
        artifacts: [{ type: 'html', url, label: 'Fallback title' }],
        render: { duration_seconds: 0, attempts: null },
      }),
    ).toMatchObject({ title: 'Fallback title', durationSeconds: null, attempts: 0, code: '' })
  })

  it('rejects missing or blank HTML artifacts', () => {
    expect(extractVideoLessonResult(undefined)).toBeNull()
    expect(extractVideoLessonResult({ artifacts: [] })).toBeNull()
    expect(extractVideoLessonResult({ artifacts: [{ type: 'html', url: ' ' }] })).toBeNull()
    expect(extractVideoLessonResult({ artifacts: [{ type: 'pdf', url: '/x.pdf' }] })).toBeNull()
  })

  it('finds the latest playable result and skips intermediate results', () => {
    const result = videoLessonFromMessage(
      [
        { type: 'result', source: 'video_lesson', metadata: { response: 'Planning' } },
        { type: 'result', source: 'video_lesson', metadata },
      ],
      'video_lesson',
    )
    expect(result?.title).toBe('Calculus')
  })

  it('trusts event source when a resumed message still has chat capability', () => {
    expect(
      videoLessonFromMessage([{ type: 'result', source: 'video_lesson', metadata }], 'chat')?.page.url,
    ).toBe(url)
  })

  it('does not turn an ordinary chat HTML artifact into a video lesson', () => {
    expect(
      videoLessonFromMessage([{ type: 'result', source: 'chat', metadata }], 'chat'),
    ).toBeNull()
  })
})
