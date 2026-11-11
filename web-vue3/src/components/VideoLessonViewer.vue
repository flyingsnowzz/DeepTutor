<script setup lang="ts">
import { computed } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { scopedUrl } from '../workspaceScope'
import type { VideoLessonResult } from '../videoLesson'

const props = defineProps<{ result: VideoLessonResult }>()

const source = computed(() => {
  const url = props.result.page.url
  return /^https?:\/\//i.test(url) ? url : scopedUrl(url)
})
const title = computed(() => props.result.title || '视频讲解')
</script>

<template>
  <section class="video-lesson-viewer">
    <header>
      <div>
        <LegacyIcon name="video" :size="14" />
        <strong>{{ title }}</strong>
      </div>
      <a :href="source" target="_blank" rel="noopener noreferrer">
        <LegacyIcon name="cornerUpRight" :size="12" />
        新标签页打开
      </a>
    </header>

    <iframe
      :src="source"
      :title="title"
      sandbox="allow-scripts"
      allow="fullscreen"
      allowfullscreen
      loading="lazy"
    />

    <div v-if="result.durationSeconds || result.attempts > 1" class="video-lesson-meta">
      <span v-if="result.durationSeconds">
        <LegacyIcon name="clock" :size="12" />
        {{ result.durationSeconds }} 秒
      </span>
      <span v-if="result.attempts > 1">经 {{ result.attempts }} 次检查后修复</span>
    </div>

    <details v-if="result.code" class="video-lesson-code">
      <summary>
        <LegacyIcon name="fileText" :size="14" />
        查看 Remotion 代码
      </summary>
      <pre><code>{{ result.code }}</code></pre>
    </details>
  </section>
</template>
