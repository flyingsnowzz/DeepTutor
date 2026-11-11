<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import WatchingMarksPanel from './WatchingMarksPanel.vue'
import {
  createVideoMark,
  deleteVideoMark,
  getVideoMaterial,
  listVideoMarks,
  saveVideoProgress,
  suggestVideoMarks,
  updateVideoMark,
  type TimedMediaMaterial,
  type TimedSegment,
  type VideoLearningMark,
  type VideoMarkKind,
  type VideoMarkSuggestion,
} from '../videoLearning'
import { markCoversTime } from '../videoLearningMarks'

const props = defineProps<{
  materialId: string
  initialLocator?: number
}>()
const emit = defineEmits<{
  locatorChange: [locator: number]
  select: [selection: { text: string; locator: number }]
}>()

const loading = ref(true)
const error = ref('')
const material = ref<TimedMediaMaterial | null>(null)
const marks = ref<VideoLearningMark[]>([])
const suggestions = ref<VideoMarkSuggestion[]>([])
const currentTime = ref(0)
const duration = ref(0)
const currentLocator = ref(props.initialLocator ?? 1)
const mediaElement = ref<HTMLMediaElement | null>(null)
const selectedKind = ref<VideoMarkKind>('key_point')
const markBusy = ref(false)
const markError = ref('')
let progressTimer = 0

const segments = computed<TimedSegment[]>(() => material.value?.segments ?? [])
const activeSegment = computed(() =>
  segments.value.find(segment =>
    markCoversTime({ start_seconds: segment.start, end_seconds: segment.end }, currentTime.value),
  ) ??
  segments.value.find(segment => segment.locator === currentLocator.value) ??
  segments.value[0] ?? null,
)
const isYouTube = computed(() => material.value?.playback.kind === 'youtube_iframe')
const youtubeEmbedUrl = computed(() => {
  const playback = material.value?.playback
  if (!playback || playback.kind !== 'youtube_iframe') return ''
  const params = new URLSearchParams({
    start: String(Math.floor(currentTime.value || playback.start_seconds || 0)),
    enablejsapi: '1',
    rel: '0',
  })
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(playback.video_id)}?${params}`
})
const htmlPlayback = computed(() => {
  const playback = material.value?.playback
  return playback && playback.kind === 'html5' ? playback : null
})
const isAudio = computed(() => htmlPlayback.value?.mime_type.startsWith('audio/'))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [timed, storedMarks] = await Promise.all([
      getVideoMaterial(props.materialId),
      listVideoMarks(props.materialId).catch(() => [] as VideoLearningMark[]),
    ])
    material.value = timed
    marks.value = timed.learning.marks?.length ? timed.learning.marks : storedMarks
    duration.value = timed.metadata.duration_seconds
    currentTime.value = timed.learning.last_position || timed.source.entry_time_seconds || 0
    currentLocator.value = segmentLocatorFor(currentTime.value)
    emit('locatorChange', currentLocator.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '视频资料加载失败'
  } finally {
    loading.value = false
  }
}

function segmentLocatorFor(time: number): number {
  const segment = segments.value.find(row => row.end >= time && row.start <= time)
  return segment?.locator ?? currentLocator.value
}

function onTimeUpdate(event: Event) {
  const media = event.target as HTMLMediaElement
  currentTime.value = media.currentTime
  duration.value = media.duration || duration.value
  const locator = segmentLocatorFor(media.currentTime)
  if (locator !== currentLocator.value) {
    currentLocator.value = locator
    emit('locatorChange', locator)
  }
  window.clearTimeout(progressTimer)
  progressTimer = window.setTimeout(persistProgress, 1200)
}

async function persistProgress() {
  if (!material.value) return
  await saveVideoProgress(props.materialId, currentTime.value, duration.value).catch(() => undefined)
}

function seekSegment(segment: TimedSegment) {
  currentTime.value = segment.start
  currentLocator.value = segment.locator
  emit('locatorChange', segment.locator)
  emit('select', { text: segment.text, locator: segment.locator })
  if (mediaElement.value) {
    mediaElement.value.currentTime = segment.start
    void mediaElement.value.play?.()?.catch?.(() => undefined)
  }
}

function seekMark(seconds: number) {
  currentTime.value = seconds
  currentLocator.value = segmentLocatorFor(seconds)
  emit('locatorChange', currentLocator.value)
  if (mediaElement.value) {
    mediaElement.value.currentTime = seconds
    void mediaElement.value.play?.()?.catch?.(() => undefined)
  }
}

async function saveCurrentMark() {
  if (!material.value || !activeSegment.value || markBusy.value) return
  markBusy.value = true
  markError.value = ''
  try {
    const saved = await createVideoMark(props.materialId, {
      kind: selectedKind.value,
      start_seconds: activeSegment.value.start,
      end_seconds: activeSegment.value.end,
      start_locator: activeSegment.value.locator,
      end_locator: activeSegment.value.locator,
      quote: activeSegment.value.text,
    })
    marks.value = [...marks.value.filter(item => item.mark_id !== saved.mark_id), saved]
  } catch (cause) {
    markError.value = cause instanceof Error ? cause.message : '标记保存失败'
  } finally {
    markBusy.value = false
  }
}

async function removeMark(markId: string) {
  await deleteVideoMark(props.materialId, markId)
  marks.value = marks.value.filter(item => item.mark_id !== markId)
}

async function reviewMark(mark: VideoLearningMark) {
  const updated = await updateVideoMark(props.materialId, mark.mark_id, { reviewed: true })
  marks.value = marks.value.map(item => item.mark_id === updated.mark_id ? updated : item)
}

async function saveSuggestion(suggestion: VideoMarkSuggestion) {
  const saved = await createVideoMark(props.materialId, {
    kind: suggestion.kind,
    start_seconds: suggestion.start_seconds,
    end_seconds: suggestion.end_seconds,
    start_locator: suggestion.start_locator,
    end_locator: suggestion.end_locator,
    quote: suggestion.quote,
    note: suggestion.note,
  })
  suggestions.value = suggestions.value.filter(item => item !== suggestion)
  marks.value = [...marks.value, saved]
}

function dismissSuggestion(suggestion: VideoMarkSuggestion) {
  suggestions.value = suggestions.value.filter(item => item !== suggestion)
}

async function loadSuggestions() {
  suggestions.value = await suggestVideoMarks(props.materialId, currentTime.value).catch(() => [])
}

watch(() => props.materialId, load, { immediate: true })
onMounted(() => window.addEventListener('beforeunload', persistProgress))
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', persistProgress)
  window.clearTimeout(progressTimer)
  void persistProgress()
})
</script>

<template>
  <section class="media-reading-stage">
    <p v-if="loading" role="status" class="media-loading">正在加载视频资料…</p>
    <p v-else-if="error" role="alert" class="error">{{ error }}</p>
    <template v-else-if="material">
      <header class="media-stage-head">
        <div>
          <h2>{{ material.metadata.title }}</h2>
          <p>{{ material.metadata.author }}</p>
        </div>
        <div class="media-mark-create">
          <select v-model="selectedKind" aria-label="标记类型">
            <option value="key_point">重点</option>
            <option value="question">疑问</option>
            <option value="review">复习</option>
          </select>
          <button type="button" :disabled="markBusy" @click="saveCurrentMark"><LegacyIcon name="bookmark" :size="14" />标记当前段落</button>
          <button type="button" @click="loadSuggestions"><LegacyIcon name="sparkles" :size="14" />建议</button>
        </div>
      </header>
      <p v-if="markError" class="error" role="alert">{{ markError }}</p>

      <div class="media-player-shell">
        <iframe
          v-if="isYouTube"
          :key="youtubeEmbedUrl"
          :src="youtubeEmbedUrl"
          :title="material.metadata.title"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        />
        <video
          v-else-if="htmlPlayback && !isAudio"
          ref="mediaElement"
          :src="htmlPlayback.stream_url"
          :poster="material.metadata.thumbnail_url"
          controls
          preload="metadata"
          crossorigin="anonymous"
          @timeupdate="onTimeUpdate"
          @loadedmetadata="onTimeUpdate"
        >
          <track v-if="htmlPlayback.subtitles_url" kind="subtitles" :src="htmlPlayback.subtitles_url" :label="material.transcript.language || 'Subtitles'" default />
        </video>
        <audio
          v-else-if="htmlPlayback && isAudio"
          ref="mediaElement"
          :src="htmlPlayback.stream_url"
          controls
          preload="metadata"
          crossorigin="anonymous"
          @timeupdate="onTimeUpdate"
          @loadedmetadata="onTimeUpdate"
        />
      </div>

      <div class="media-stage-grid">
        <section class="media-transcript">
          <header><h3>字幕 / 逐段文稿</h3><span>{{ activeSegment?.locator ?? 0 }} / {{ segments.length }}</span></header>
          <p v-if="material.transcript.status === 'unavailable'" class="muted">{{ material.transcript.reason || '字幕不可用。' }}</p>
          <ol v-else>
            <li v-for="segment in segments" :key="segment.locator" :class="{ active: segment.locator === activeSegment?.locator }">
              <button type="button" @click="seekSegment(segment)">
                <time>{{ segment.locator }}</time>
                <span>{{ segment.text }}</span>
              </button>
            </li>
          </ol>
        </section>
        <WatchingMarksPanel
          :marks="marks"
          :suggestions="suggestions"
          :current-time="currentTime"
          :busy="markBusy"
          :error="markError"
          @seek="seekMark"
          @delete="removeMark"
          @review="reviewMark"
          @save-suggestion="saveSuggestion"
          @dismiss-suggestion="dismissSuggestion"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.media-reading-stage{display:grid;gap:14px;min-height:0}
.media-loading{color:var(--muted-foreground);font-size:13px}
.media-stage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.media-stage-head h2{margin:0;font-size:17px}.media-stage-head p{margin:4px 0 0;color:var(--muted-foreground);font-size:12px}
.media-mark-create{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.media-mark-create select,.media-mark-create button{height:32px;padding:0 9px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--foreground);font-size:11px;cursor:pointer}
.media-mark-create button{display:inline-flex;align-items:center;gap:5px}
.media-player-shell{overflow:hidden;border:1px solid var(--border);border-radius:12px;background:#050505;min-height:320px}
.media-player-shell iframe,.media-player-shell video{display:block;width:100%;aspect-ratio:16/9;border:0;background:#050505}
.media-player-shell audio{display:block;width:100%;margin:auto 0}
.media-stage-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);gap:14px;min-height:0}
.media-transcript{display:flex;flex-direction:column;min-height:0;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.media-transcript header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px}
.media-transcript h3{margin:0;font-size:13px}.media-transcript ol{display:grid;gap:4px;margin:0;padding:8px;overflow:auto;max-height:440px;list-style:none}
.media-transcript li button{display:grid;grid-template-columns:34px minmax(0,1fr);gap:8px;width:100%;padding:7px 8px;border:0;border-radius:7px;background:transparent;text-align:left;cursor:pointer}
.media-transcript li.active button{background:color-mix(in srgb,var(--primary) 10%,transparent)}
.media-transcript time{color:var(--muted-foreground);font-family:var(--font-mono,monospace);font-size:10px}
.media-transcript span{font-size:12px;line-height:1.55}
@media(max-width:900px){.media-stage-grid{grid-template-columns:1fr}.media-stage-head{flex-direction:column}.media-mark-create{justify-content:flex-start}}
</style>
