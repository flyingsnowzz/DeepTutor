<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { scopedUrl } from '../workspaceScope'
import { audioPlaybackState } from '../chatAudioPlayback'

const props = withDefaults(defineProps<{ content: string; autoPlayFresh?: boolean; autoplayEnabled?: boolean }>(), { autoPlayFresh: false, autoplayEnabled: false })
const emit = defineEmits<{ failed: [message: string] }>()
const state = ref<'idle' | 'loading' | 'playing'>('idle')
const owner = {}
let audio: HTMLAudioElement | null = null
let url = ''
let abort: AbortController | null = null
let generation = 0
let autoPlayed = false
let autoplayTimer: ReturnType<typeof setTimeout> | undefined
const SILENT_UNLOCK_WAV =
  "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
function cleanup() {
  abort?.abort(); abort = null
  audio?.pause(); audio = null
  if (url) URL.revokeObjectURL(url); url = ''
}
function stop() {
  generation += 1
  cleanup()
  state.value = 'idle'
  if (audioPlaybackState.active?.owner === owner) audioPlaybackState.active = null
}
async function errorDetail(response: Response) {
  try {
    const body = await response.json() as { detail?: unknown }
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail)) return String((body.detail[0] as { msg?: string })?.msg || '')
  } catch { /* Non-JSON response. */ }
  return ''
}
async function play() {
  if (!props.content.trim()) return
  audioPlaybackState.active?.stop()
  const current = ++generation
  abort?.abort(); abort = new AbortController()
  audioPlaybackState.active = { owner, stop }
  state.value = 'loading'
  audio = new Audio(SILENT_UNLOCK_WAV)
  void Promise.resolve(audio.play()).catch(() => null)
  try {
    const response = await fetch(scopedUrl('/api/voice/tts'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: props.content }), signal: abort.signal })
    if (current !== generation) return
    if (!response.ok) {
      const detail = await errorDetail(response)
      if (current !== generation) return
      emit('failed', detail || (response.status === 504 ? '语音生成超时，请稍后重试。' : '无法播放这条回复。'))
      stop(); return
    }
    const blob = await response.blob()
    if (current !== generation || !audio) return
    if (url) URL.revokeObjectURL(url)
    url = URL.createObjectURL(blob)
    audio.src = url; audio.load()
    audio.onended = () => { if (current === generation) stop() }
    audio.onerror = () => { if (current === generation) { emit('failed', '无法播放这条回复。'); stop() } }
    await audio.play()
    if (current !== generation) { audio.pause(); return }
    state.value = 'playing'
  } catch (cause) {
    if (current !== generation || (cause instanceof Error && cause.name === 'AbortError')) return
    emit('failed', '无法播放这条回复。')
    stop()
  }
}
function toggle() { if (state.value === 'idle') void play(); else stop() }
watch(() => [props.autoPlayFresh, props.autoplayEnabled, props.content] as const, ([fresh, enabled, content]) => {
  if (!fresh || !enabled || autoPlayed || !content.trim()) return
  autoPlayed = true
  autoplayTimer = setTimeout(() => void play(), 0)
}, { immediate: true })
onUnmounted(() => { if (autoplayTimer) clearTimeout(autoplayTimer); if (audioPlaybackState.active?.owner === owner) stop(); else { generation += 1; cleanup() } })
</script>

<template><button type="button" class="chat-play-audio" :class="{ loading: state === 'loading' }" :title="state === 'idle' ? '朗读' : '停止朗读'" :aria-label="state === 'idle' ? '朗读' : '停止朗读'" @click="toggle"><LegacyIcon v-if="state === 'idle'" name="voice" :size="15" /><span v-else-if="state === 'loading'" class="chat-audio-spinner" /><LegacyIcon v-else name="stop" :size="13" /></button></template>
