<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { scopedUrl } from '../workspaceScope'
import { mathArtifactsByType, type MathAnimatorResult } from '../mathAnimator'

const props = defineProps<{ result: MathAnimatorResult }>()
const root = ref<HTMLElement | null>(null)
const fullscreenUrl = ref('')
const images = computed(() => mathArtifactsByType(props.result, 'image'))
const videos = computed(() => mathArtifactsByType(props.result, 'video'))
const timingText = computed(() =>
  Object.entries(props.result.timings)
    .map(([key, value]) => `${key} ${value}s`)
    .join(' · '),
)
const visualReview = computed(() => props.result.render.visual_review ?? null)

function source(url: string) {
  return /^https?:\/\//i.test(url) ? url : scopedUrl(url)
}
function openFullscreen(url: string) {
  fullscreenUrl.value = source(url)
}

function onWheel(event: WheelEvent) {
  const el = root.value
  if (!el || Math.abs(event.deltaY) < 1) return
  let node = event.target as HTMLElement | null
  while (node && node !== el) {
    if (node.scrollHeight > node.clientHeight + 2) {
      const style = window.getComputedStyle(node)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 2
        const atTop = node.scrollTop <= 2
        if ((event.deltaY > 0 && !atBottom) || (event.deltaY < 0 && !atTop)) return
      }
    }
    node = node.parentElement
  }
  let scrollRoot = el.closest<HTMLElement>("[data-chat-scroll-root='true']")
  if (!scrollRoot) {
    let parent = el.parentElement
    while (parent) {
      const style = window.getComputedStyle(parent)
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight + 2) {
        scrollRoot = parent
        break
      }
      parent = parent.parentElement
    }
  }
  if (scrollRoot) {
    event.preventDefault()
    scrollRoot.scrollBy({ top: event.deltaY, behavior: 'auto' })
  }
}

onMounted(() => root.value?.addEventListener('wheel', onWheel, { passive: false }))
onUnmounted(() => root.value?.removeEventListener('wheel', onWheel))
</script>

<template>
  <section ref="root" class="math-animator-viewer">
    <div v-if="videos.length" class="math-animator-section">
      <h3><LegacyIcon name="video" :size="14" />视频输出</h3>
      <video
        v-for="item in videos"
        :key="item.url"
        controls
        playsinline
        preload="metadata"
        :src="source(item.url)"
      />
    </div>

    <div v-if="images.length" class="math-animator-section">
      <h3><LegacyIcon name="image" :size="14" />图片输出</h3>
      <div class="math-animator-images">
        <button
          v-for="item in images"
          :key="item.url"
          type="button"
          class="math-animator-image"
          @click="openFullscreen(item.url)"
        >
          <img :src="source(item.url)" :alt="item.label || item.filename">
          <span><LegacyIcon name="cornerUpRight" :size="12" />全屏</span>
        </button>
      </div>
    </div>

    <details v-if="result.code.content" class="math-animator-code">
      <summary><LegacyIcon name="fileText" :size="14" />查看 Manim 代码</summary>
      <pre><code>{{ result.code.content }}</code></pre>
    </details>

    <div v-if="visualReview && visualReview.passed === false" class="math-animator-warning">
      <strong>视觉审查警告：</strong>{{ visualReview.summary || '生成结果仍存在展示问题。' }}
      <div v-if="visualReview.issues?.length">{{ visualReview.issues.join(' ') }}</div>
    </div>

    <div v-if="result.render.quality || typeof result.render.retry_attempts === 'number' || timingText" class="math-animator-meta">
      <span v-if="result.render.quality">质量：{{ result.render.quality }}</span>
      <span v-if="typeof result.render.retry_attempts === 'number'">重试：{{ result.render.retry_attempts }}</span>
      <span v-if="timingText"><LegacyIcon name="clock" :size="12" />{{ timingText }}</span>
    </div>

    <div v-if="fullscreenUrl" class="math-animator-fullscreen" @click.self="fullscreenUrl = ''">
      <button type="button" aria-label="关闭全屏预览" @click="fullscreenUrl = ''">×</button>
      <img :src="fullscreenUrl" alt="数学动画全屏输出">
    </div>
  </section>
</template>
