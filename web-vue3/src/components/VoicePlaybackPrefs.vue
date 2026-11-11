<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { loadVoicePreferences, setVoiceAutoplay, setVoiceMathSpeak } from '../voicePreferences'

const autoplay = ref(false)
const mathSpeak = ref(true)
const loading = ref(true)
const busy = ref<'autoplay' | 'math' | ''>('')
const error = ref('')
onMounted(async () => { const result = await loadVoicePreferences(); autoplay.value = result.autoplay; mathSpeak.value = result.mathSpeak; loading.value = false })
async function toggleAutoplay() {
  if (busy.value) return
  const next = !autoplay.value
  autoplay.value = next; busy.value = 'autoplay'; error.value = ''
  try { await setVoiceAutoplay(next) } catch (cause) { autoplay.value = !next; error.value = cause instanceof Error ? cause.message : '自动播放设置保存失败' } finally { busy.value = '' }
}
async function toggleMathSpeak() {
  if (busy.value) return
  const next = !mathSpeak.value
  mathSpeak.value = next; busy.value = 'math'; error.value = ''
  try { await setVoiceMathSpeak(next) } catch (cause) { mathSpeak.value = !next; error.value = cause instanceof Error ? cause.message : '数学朗读设置保存失败' } finally { busy.value = '' }
}
</script>

<template>
  <section class="voice-playback-preferences"><header><h2>播放</h2><p>设置聊天中朗读回复的行为。</p></header><div class="voice-playback-list">
    <div class="voice-playback-row"><div><strong>自动播放回复</strong><p>自动朗读每条助手回复，也可以在对话中通过朗读按钮控制。</p></div><button type="button" role="switch" :aria-checked="autoplay" aria-label="自动播放回复" :disabled="loading || busy === 'autoplay'" @click="toggleAutoplay"><span /></button></div>
    <div class="voice-playback-row"><div><strong>数学朗读</strong><p>将 LaTeX 读成分数、幂和希腊字母等自然语言；关闭后保留更接近书面数学的形式，美元符号始终不会读出。</p></div><button type="button" role="switch" :aria-checked="mathSpeak" aria-label="数学朗读" :disabled="loading || busy === 'math'" @click="toggleMathSpeak"><span /></button></div>
  </div><p v-if="error" class="error" role="alert">{{ error }}</p></section>
</template>
