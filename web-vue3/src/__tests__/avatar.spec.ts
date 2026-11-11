import { describe, expect, it } from 'vitest'
import { AVATAR_COLORS, AVATAR_ICON_NAMES, fallbackAvatarFor, parseAvatarMarker } from '../avatar'

describe('avatar markers', () => {
  it('uses a stable fallback and validates stored marker values', () => {
    expect(fallbackAvatarFor('learner')).toEqual(fallbackAvatarFor('learner'))
    expect(AVATAR_ICON_NAMES).toContain(fallbackAvatarFor('learner').icon)
    expect(AVATAR_COLORS[fallbackAvatarFor('learner').color]).toBeTruthy()
    expect(parseAvatarMarker('icon:star:blue')).toEqual({ kind: 'icon', icon: 'star', color: 'blue' })
    expect(parseAvatarMarker('icon:unknown:blue').kind).toBe('fallback')
    expect(parseAvatarMarker('img:123')).toEqual({ kind: 'image', version: '123' })
  })
})
