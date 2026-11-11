export const AVATAR_ICON_NAMES = ['sparkles', 'sprout', 'leaf', 'feather', 'cloud', 'droplet', 'sun', 'moon', 'flame', 'star', 'heart', 'lightbulb', 'compass', 'cherry', 'cookie', 'music'] as const
export const AVATAR_COLORS: Record<string, string> = { violet: '#7c5fd3', blue: '#3f7cc8', teal: '#2a9d8f', green: '#4f9d4f', amber: '#c98a2d', rose: '#d05c7c', slate: '#6b7a8c', pink: '#bb5fb2' }
export const AVATAR_COLOR_NAMES = Object.keys(AVATAR_COLORS)
export const AVATAR_EMOJI: Record<string, string> = { sparkles: '✨', sprout: '🌱', leaf: '🍃', feather: '🪶', cloud: '☁️', droplet: '💧', sun: '☀️', moon: '🌙', flame: '🔥', star: '⭐', heart: '♥', lightbulb: '💡', compass: '🧭', cherry: '🍒', cookie: '🍪', music: '🎵' }
function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return hash >>> 0
}
export function fallbackAvatarFor(username: string) {
  const hash = hashString(username || 'user')
  return { icon: AVATAR_ICON_NAMES[hash % AVATAR_ICON_NAMES.length], color: AVATAR_COLOR_NAMES[(hash >>> 4) % AVATAR_COLOR_NAMES.length] }
}
export type AvatarDescriptor = { kind: 'image'; version: string } | { kind: 'icon'; icon: string; color: string } | { kind: 'fallback' }
export function parseAvatarMarker(marker?: string | null): AvatarDescriptor {
  const value = (marker || '').trim()
  if (value.startsWith('img:')) return { kind: 'image', version: value.slice(4) }
  const match = /^icon:([a-z0-9-]+):([a-z0-9-]+)$/.exec(value)
  if (match && AVATAR_ICON_NAMES.includes(match[1] as typeof AVATAR_ICON_NAMES[number]) && AVATAR_COLORS[match[2]]) return { kind: 'icon', icon: match[1], color: match[2] }
  return { kind: 'fallback' }
}
