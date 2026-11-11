<script setup lang="ts">
import { computed, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import {
  VIDEO_MARK_COLORS,
  VIDEO_MARK_KINDS,
  filterMarks,
  formatMarkRange,
  markCoversTime,
} from '../videoLearningMarks'
import type { VideoLearningMark, VideoMarkKind, VideoMarkSuggestion } from '../videoLearning'

const props = withDefaults(defineProps<{
  marks: VideoLearningMark[]
  suggestions?: VideoMarkSuggestion[]
  currentTime?: number
  error?: string
  busy?: boolean
}>(), { suggestions: () => [], currentTime: 0, error: '', busy: false })
const emit = defineEmits<{
  seek: [seconds: number]
  delete: [markId: string]
  review: [mark: VideoLearningMark]
  'save-suggestion': [suggestion: VideoMarkSuggestion]
  'dismiss-suggestion': [suggestion: VideoMarkSuggestion]
}>()
const filter = ref<VideoMarkKind | 'all'>('all')
const visible = computed(() => filterMarks(props.marks, filter.value))

function label(kind: VideoMarkKind) {
  return { key_point: '重点', question: '疑问', review: '稍后复习' }[kind]
}
</script>

<template>
  <section class="watching-marks-panel">
    <p v-if="error" class="watching-marks-error" role="alert">{{ error }}</p>
    <div v-if="suggestions.length" class="watching-mark-suggestions">
      <h4>建议标记</h4>
      <article v-for="(suggestion, index) in suggestions" :key="`${suggestion.kind}-${suggestion.start_seconds}-${index}`">
        <span :style="{ color: VIDEO_MARK_COLORS[suggestion.kind] }">{{ label(suggestion.kind) }}</span>
        <button type="button" class="watching-time-link" @click="emit('seek', suggestion.start_seconds)">{{ formatMarkRange(suggestion) }}</button>
        <button type="button" class="primary" :disabled="busy" @click="emit('save-suggestion', suggestion)">保存</button>
        <button type="button" aria-label="忽略建议" :disabled="busy" @click="emit('dismiss-suggestion', suggestion)"><LegacyIcon name="close" :size="12" /></button>
        <p v-if="suggestion.quote">{{ suggestion.quote }}</p>
      </article>
    </div>

    <div class="watching-mark-filters" role="group" aria-label="筛选标记">
      <button v-for="kind in VIDEO_MARK_KINDS" :key="kind" type="button" :aria-pressed="filter === kind" :class="{ active: filter === kind }" @click="filter = kind">
        {{ kind === 'all' ? '全部' : label(kind) }}
      </button>
    </div>

    <div v-if="visible.length" class="watching-mark-list">
      <article v-for="mark in visible" :key="mark.mark_id" :data-testid="`watching-mark-${mark.kind}`" :class="{ active: markCoversTime(mark, currentTime) }">
        <header>
          <LegacyIcon :name="mark.kind === 'question' ? 'questions' : 'bookmark'" :size="14" />
          <span :style="{ color: VIDEO_MARK_COLORS[mark.kind] }">{{ label(mark.kind) }}</span>
          <button type="button" class="watching-time-link" @click="emit('seek', mark.start_seconds)"><LegacyIcon name="play" :size="11" />{{ formatMarkRange(mark) }}</button>
          <button v-if="!mark.reviewed_at && mark.kind === 'review'" type="button" aria-label="标记为已复习" :disabled="busy" @click="emit('review', mark)"><LegacyIcon name="rotateCcw" :size="13" /></button>
          <button type="button" class="watching-mark-delete" aria-label="删除标记" :disabled="busy" @click="emit('delete', mark.mark_id)"><LegacyIcon name="trash" :size="13" /></button>
        </header>
        <p v-if="mark.quote">{{ mark.quote }}</p>
        <small v-if="mark.note">{{ mark.note }}</small>
        <small v-if="mark.reviewed_at" class="watched">已复习</small>
      </article>
    </div>
    <p v-else class="watching-marks-empty">还没有标记。</p>
  </section>
</template>

<style scoped>
.watching-marks-panel{display:grid;gap:12px}
.watching-marks-error{margin:0;padding:8px 10px;border:1px solid color-mix(in srgb,var(--destructive) 35%,var(--border));border-radius:8px;color:var(--destructive);font-size:12px}
.watching-mark-suggestions{display:grid;gap:7px;padding:10px;border:1px dashed var(--border);border-radius:10px}
.watching-mark-suggestions h4{margin:0;color:var(--muted-foreground);font-size:10px;letter-spacing:.06em;text-transform:uppercase}
.watching-mark-suggestions article{display:grid;grid-template-columns:auto auto auto auto;align-items:center;gap:6px;padding:7px;border-radius:7px;background:var(--muted)}
.watching-mark-suggestions article p{grid-column:1/-1;margin:0;font-size:12px}
.watching-mark-suggestions article button{border:0;background:transparent;color:var(--foreground);font-size:11px;cursor:pointer}
.watching-mark-suggestions article button.primary{padding:4px 8px;border-radius:5px;background:var(--primary);color:var(--primary-foreground)}
.watching-mark-filters{display:flex;flex-wrap:wrap;gap:4px}
.watching-mark-filters button{padding:5px 9px;border:1px solid var(--border);border-radius:999px;background:var(--background);color:var(--muted-foreground);font-size:11px;cursor:pointer}
.watching-mark-filters button.active{background:var(--muted);color:var(--foreground);font-weight:600}
.watching-mark-list{display:grid;gap:7px;max-height:420px;overflow:auto}
.watching-mark-list article{display:grid;gap:4px;padding:9px;border:1px solid var(--border);border-radius:9px}
.watching-mark-list article.active{border-color:color-mix(in srgb,#3b82f6 50%,var(--border));background:color-mix(in srgb,#3b82f6 8%,transparent)}
.watching-mark-list article header{display:flex;align-items:center;gap:6px;font-size:11px}
.watching-mark-list article p{margin:0;color:var(--foreground);font-size:12px}
.watching-mark-list article small{color:var(--muted-foreground);font-size:10.5px}
.watching-mark-list article header>button{margin-left:auto;border:0;background:transparent;color:var(--muted-foreground);cursor:pointer}
.watching-mark-list article header>button.watching-time-link{margin-left:auto;display:inline-flex;align-items:center;gap:3px;color:#2563eb;font-family:var(--font-mono,monospace)}
.watching-mark-list article header>button.watching-mark-delete{color:var(--destructive)}
.watched{color:var(--primary)!important}
.watching-marks-empty{margin:0;color:var(--muted-foreground);font-size:12px}
</style>
