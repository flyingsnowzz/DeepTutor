<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import {
  canPreview,
  DEFAULT_VOICE_PREVIEW_TEXT,
  isPlayableAudio,
  MAX_PREVIEW_CHARS,
  readPreviewError,
  speechRequestTimeout,
  type TimedModel,
} from '../voicePreview'

const props = defineProps<{
  profileId: string
  modelId?: string
  catalog: unknown
  model?: TimedModel
}>()

const text = ref(DEFAULT_VOICE_PREVIEW_TEXT)
const pending = ref(false)
const audioUrl = ref('')
const errorMessage = ref('')

let controller: AbortController | null = null
let timeoutId: ReturnType<typeof setTimeout> | undefined
let objectUrl = ''

function clear() {
  controller?.abort()
  pending.value = false
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
  audioUrl.value = ''
  errorMessage.value = ''
}

async function preview() {
  clear()
  if (!canPreview(text.value)) return
  const request = new AbortController()
  controller = request
  pending.value = true
  // Backend deadline plus a small grace window for its error response.
  timeoutId = setTimeout(() => request.abort(), (speechRequestTimeout(props.model) + 5) * 1000)
  try {
    const response = await fetch('/api/settings/voice/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: request.signal,
      body: JSON.stringify({
        catalog: props.catalog,
        profile_id: props.profileId,
        model_id: props.modelId,
        text: text.value,
      }),
    })
    if (!response.ok) {
      throw new Error(await readPreviewError(response))
    }
    const blob = await response.blob()
    if (request.signal.aborted) return
    if (!isPlayableAudio(blob)) throw new Error('提供方未返回可播放的音频。')
    objectUrl = URL.createObjectURL(blob)
    audioUrl.value = objectUrl
  } catch (cause) {
    if (request.signal.aborted) {
      if (controller === request) errorMessage.value = '语音合成超时，请在语音模型设置中调大请求超时或缩短文本。'
    } else {
      errorMessage.value = cause instanceof Error ? cause.message : '语音预览失败。'
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (controller === request) pending.value = false
  }
}

onBeforeUnmount(() => {
  controller?.abort()
  if (timeoutId) clearTimeout(timeoutId)
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <section class="voice-preview" aria-label="语音预览">
    <header class="voice-preview-head">
      <h4>语音预览</h4>
      <button
        type="button"
        class="voice-preview-run"
        :disabled="pending || !canPreview(text)"
        @click="preview"
      >
        <LegacyIcon :name="pending ? 'activity' : 'voice'" :size="15" />
        {{ pending ? '生成预览中…' : '试听语音' }}
      </button>
    </header>

    <label class="voice-preview-label" for="voice-preview-text">预览文本</label>
    <textarea
      id="voice-preview-text"
      v-model="text"
      rows="3"
      :maxlength="MAX_PREVIEW_CHARS"
      :disabled="pending"
      @input="clear"
    />
    <p class="voice-preview-hint">使用当前表单配置，不会保存。请选用与该语音匹配语言的文本，提供方可能对此合成计费。</p>

    <button v-if="pending" type="button" class="voice-preview-cancel" @click="clear">取消</button>
    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    <audio v-if="audioUrl" controls autoplay :src="audioUrl" class="voice-preview-audio" aria-label="生成的语音预览" />
  </section>
</template>
