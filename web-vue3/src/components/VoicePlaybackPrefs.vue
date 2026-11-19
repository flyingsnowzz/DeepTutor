<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { loadVoicePreferences, setVoiceAutoplay, setVoiceMathSpeak } from '../voicePreferences'

const props = defineProps<{ language?: string }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const autoplay = ref(false)
const mathSpeak = ref(true)
const loading = ref(true)
const busy = ref<'autoplay' | 'math' | ''>('')
const error = ref('')
let active = true
onMounted(async () => { const result = await loadVoicePreferences(); if (!active) return; autoplay.value = result.autoplay; mathSpeak.value = result.mathSpeak; loading.value = false })
onUnmounted(() => { active = false })
async function toggleAutoplay() {
  if (busy.value) return
  const next = !autoplay.value
  autoplay.value = next; busy.value = 'autoplay'; error.value = ''
  try { await setVoiceAutoplay(next) } catch (cause) { autoplay.value = !next; error.value = cause instanceof Error ? cause.message : tr('自动播放设置保存失败', 'Failed to save auto-play setting') } finally { busy.value = '' }
}
async function toggleMathSpeak() {
  if (busy.value) return
  const next = !mathSpeak.value
  mathSpeak.value = next; busy.value = 'math'; error.value = ''
  try { await setVoiceMathSpeak(next) } catch (cause) { mathSpeak.value = !next; error.value = cause instanceof Error ? cause.message : tr('数学朗读设置保存失败', 'Failed to save math speak setting') } finally { busy.value = '' }
}
</script>

<template>
  <section class="voice-playback-preferences"><header><h2>{{ tr('播放', 'Playback') }}</h2><p>{{ tr('语音回复在聊天中的行为。', 'How spoken replies behave in chat.') }}</p></header><div class="voice-playback-list">
    <div class="voice-playback-row"><div><strong>{{ tr('自动朗读回复', 'Auto-play replies') }}</strong><p>{{ tr('自动朗读每条助手回复，也可以在对话中通过朗读按钮控制。', 'Read each assistant reply aloud automatically. You can also toggle this per conversation from the speaker button.') }}</p></div><button type="button" role="switch" :aria-checked="autoplay" :aria-label="tr('自动朗读回复', 'Auto-play replies')" :disabled="loading || Boolean(busy)" @click="toggleAutoplay"><span /></button></div>
    <div class="voice-playback-row"><div><strong>{{ tr('数学朗读', 'Math speak') }}</strong><p>{{ tr('把 LaTeX 读成自然语言（分数、乘方、希腊字母）。关闭后更接近书面公式；仍不会读出美元符号。', 'Read LaTeX as words — fractions, powers, and Greek letters. Turn this off to keep formulas closer to the written math. Dollar signs are never spoken.') }}</p></div><button type="button" role="switch" :aria-checked="mathSpeak" :aria-label="tr('数学朗读', 'Math speak')" :disabled="loading || Boolean(busy)" @click="toggleMathSpeak"><span /></button></div>
  </div><p v-if="error" class="error" role="alert">{{ error }}</p></section>
</template>
