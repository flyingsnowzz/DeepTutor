import { describe, expect, it } from 'vitest'
import { extractMathAnimatorResult, mathArtifactsByType } from '../mathAnimator'

describe('math animator extraction', () => {
  it('ignores generic response-only payloads', () => {
    expect(
      extractMathAnimatorResult({
        response: 'Hello',
        metadata: { cost_summary: { total_tokens: 1043 } },
      }),
    ).toBeNull()
  })

  it('extracts image output and filters malformed artifacts', () => {
    const result = extractMathAnimatorResult({
      response: 'Storyboard generated.',
      output_mode: 'image',
      artifacts: [
        { type: 'image', url: '/api/files/frame-1.png', filename: 'frame-1.png', label: 'Frame 1' },
        { type: 'image', url: '/api/files/bad.png' },
      ],
    })
    expect(result?.output_mode).toBe('image')
    expect(result?.artifacts).toHaveLength(1)
    expect(mathArtifactsByType(result!, 'image')).toHaveLength(1)
  })

  it('defaults output mode to video and normalizes code/timing/render fields', () => {
    const result = extractMathAnimatorResult({
      output_mode: 'unexpected',
      code: { language: 'python', content: 'class Scene(Scene): pass' },
      timings: { render: 2.5, invalid: 'nope' },
      render: { quality: 'high', retry_attempts: 1, visual_review: { passed: false } },
    })
    expect(result).toMatchObject({
      output_mode: 'video',
      code: { language: 'python', content: 'class Scene(Scene): pass' },
      timings: { render: 2.5 },
    })
    expect(result?.render.quality).toBe('high')
  })

  it('accepts render metadata or timings without artifacts', () => {
    expect(extractMathAnimatorResult({ render: { quality: 'preview' } })).not.toBeNull()
    expect(extractMathAnimatorResult({ timings: { code_generation: 1 } })).not.toBeNull()
  })
})
