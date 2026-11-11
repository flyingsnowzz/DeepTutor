<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import {
  audioExtType,
  isAudioFileAcceptable,
  isEmptyResult,
  reducePreviewEvent,
  validatePreviewInput,
  type PreviewPhase,
  type PreviewResult,
  type PreviewService,
  type PreviewState,
  type StreamEvent,
} from '../servicePreview'

const props = defineProps<{
  service: PreviewService
  profileId: string
  modelId?: string
  catalog: unknown
}>()

const text = ref('')
const audioFile = ref<File | null>(null)
const audioUrl = ref('')
const state = ref<PreviewState>('idle')
const phase = ref<PreviewPhase>('requesting')
const result = ref<PreviewResult | null>(null)
const errorMessage = ref('')

let controller: AbortController | null = null
let timeoutId: ReturnType<typeof setTimeout> | undefined
let mediaUrl = ''

const isStt = computed(() => props.service === 'stt')
const running = computed(() => state.value === 'running')
const timeoutMs = computed(() => (props.service === 'videogen' ? 610_000 : 130_000))

const stateText = computed(() => {
  if (state.value === 'success') return isEmptyResult(result.value as PreviewResult) ? '结果为空' : '预览成功'
  if (state.value === 'running') return phase.value === 'rendering' ? '渲染中…' : '请求中…'
  if (state.value === 'timeout') return '请求超时'
  if (state.value === 'failed') return '预览失败'
  if (state.value === 'invalidAudio') return '音频文件无效（≤8MB，支持 WAV/MP3/M4A/WebM/OGG/FLAC）'
  return '发送一条真实请求，验证当前草稿配置。'
})

function pickAudio(event: Event) {
  clearResult()
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  if (file && !isAudioFileAcceptable(file)) {
    audioFile.value = null
    state.value = 'invalidAudio'
    input.value = ''
    return
  }
  audioFile.value = file
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = file ? URL.createObjectURL(file) : ''
}

function clearResult() {
  result.value = null
  state.value = 'idle'
  errorMessage.value = ''
  if (mediaUrl) {
    URL.revokeObjectURL(mediaUrl)
    mediaUrl = ''
  }
}

async function readAudioBase64(): Promise<{ audio: string; contentType: string }> {
  if (!audioFile.value) return { audio: '', contentType: '' }
  const contentType = audioExtType(audioFile.value.name) || audioFile.value.type
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('audio'))
    reader.readAsDataURL(audioFile.value as File)
  })
  return { audio: dataUrl.split(',')[1] ?? '', contentType }
}

async function run() {
  clearResult()
  let audio = ''
  let contentType = ''
  try {
    if (isStt.value) {
      const decoded = await readAudioBase64()
      audio = decoded.audio
      contentType = decoded.contentType
    }
    validatePreviewInput(props.service, text.value, audio, contentType)
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : '输入无效'
    state.value = isStt.value && !audioFile.value ? 'invalidAudio' : 'failed'
    return
  }

  controller = new AbortController()
  state.value = 'running'
  phase.value = 'requesting'
  timeoutId = setTimeout(() => controller?.abort(), timeoutMs.value)

  try {
    const response = await fetch(`/api/settings/services/${props.service}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        catalog: props.catalog,
        profile_id: props.profileId,
        model_id: props.modelId,
        text: text.value.trim(),
        audio,
        content_type: contentType,
      }),
    })
    if (!response.ok || !response.body) throw new Error('request')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let settled = false
    try {
      while (!settled) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        if (buffer.length > 60 * 1024 * 1024) throw new Error('size')
        let newline: number
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (!line.trim()) continue
          const event = JSON.parse(line) as StreamEvent
          const next = reducePreviewEvent(event)
          phase.value = next.phase
          if (next.result) result.value = next.result
          if (next.state === 'success' || next.state === 'failed' || next.state === 'timeout') {
            state.value = next.state
            if (next.result?.url) mediaUrl = next.result.url
            settled = true
          }
        }
        if (chunk.done) {
          if (!settled) throw new Error('incomplete')
          break
        }
      }
    } finally {
      reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } catch (cause) {
    if (controller?.signal.aborted) state.value = 'timeout'
    else errorMessage.value = cause instanceof Error ? cause.message : '预览失败'
    if (!controller?.signal.aborted) state.value = 'failed'
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    controller = null
  }
}

function stop() {
  controller?.abort()
}

onBeforeUnmount(() => {
  controller?.abort()
  if (timeoutId) clearTimeout(timeoutId)
  if (mediaUrl) URL.revokeObjectURL(mediaUrl)
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})
</script>

<template>
  <section class="service-preview" :aria-label="`服务预览：${service}`">
    <header class="service-preview-head">
      <h4>服务预览</h4>
      <p>{{ stateText }}</p>
    </header>

    <div v-if="isStt" class="service-preview-field">
      <label>
        音频样本
        <input type="file" accept=".wav,.mp3,.m4a,.webm,.ogg,.flac,audio/*" :disabled="running" @change="pickAudio" />
      </label>
      <audio v-if="audioUrl" controls :src="audioUrl" class="service-preview-audio" />
    </div>
    <div v-else class="service-preview-field">
      <label>
        预览文本
        <textarea v-model="text" rows="3" maxlength="2000" :disabled="running" placeholder="输入 1–2000 个字符" />
      </label>
    </div>

    <div class="service-preview-actions">
      <button type="button" class="service-preview-run" :disabled="running" @click="run">
        <LegacyIcon name="activity" :size="14" />运行预览
      </button>
      <button v-if="running" type="button" class="service-preview-stop" @click="stop">
        <LegacyIcon name="close" :size="14" />停止
      </button>
    </div>

    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

    <div v-if="result" class="service-preview-result" :class="`kind-${result.kind}`">
      <p v-if="result.text" class="service-preview-text">{{ result.text }}</p>
      <ul v-if="result.results?.length" class="service-preview-search">
        <li v-for="(item, index) in result.results" :key="`${item.url}-${index}`">
          <a :href="item.url" target="_blank" rel="noopener">{{ item.title }}</a>
          <small>{{ item.snippet }}</small>
        </li>
      </ul>
      <img v-if="result.kind === 'image' && result.url" :src="result.url" alt="预览图片" class="service-preview-media" />
      <video v-if="result.kind === 'video' && result.url" controls :src="result.url" class="service-preview-media" />
    </div>
  </section>
</template>
