<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { scopedUrl } from '../workspaceScope'
import { presentedSourcePages, type PresentedSourcePage } from '../masterySourcePresentation'

type StreamLikeEvent = {
  type?: string
  source?: string
  metadata?: Record<string, unknown>
}
const props = defineProps<{ events?: StreamLikeEvent[] }>()
const pages = ref<PresentedSourcePage[]>([])
const sources = new Map<string, { url: string; status: 'loading' | 'ready' | 'error' }>()
const urls = ref<Record<string, { url: string; status: 'loading' | 'ready' | 'error' }>>({})

async function loadPage(page: PresentedSourcePage) {
  if (sources.has(page.preview_url)) return
  const entry = { url: '', status: 'loading' as const }
  sources.set(page.preview_url, entry)
  urls.value = { ...urls.value, [page.preview_url]: entry }
  try {
    const response = await fetch(scopedUrl(page.preview_url), { credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const objectUrl = URL.createObjectURL(await response.blob())
    sources.set(page.preview_url, { url: objectUrl, status: 'ready' })
    urls.value = { ...urls.value, [page.preview_url]: { url: objectUrl, status: 'ready' } }
  } catch {
    sources.set(page.preview_url, { url: '', status: 'error' })
    urls.value = { ...urls.value, [page.preview_url]: { url: '', status: 'error' } }
  }
}

watch(
  () => props.events,
  events => {
    pages.value = presentedSourcePages(events)
    for (const page of pages.value) void loadPage(page)
  },
  { immediate: true, deep: true },
)

onMounted(() => { for (const page of pages.value) void loadPage(page) })
onBeforeUnmount(() => {
  for (const entry of sources.values()) if (entry.url) URL.revokeObjectURL(entry.url)
})
</script>

<template>
  <div v-if="pages.length" class="mastery-source-presentation">
    <figure v-for="page in pages" :key="page.preview_url">
      <figcaption>{{ page.title }}</figcaption>
      <img v-if="urls[page.preview_url]?.status === 'ready'" :src="urls[page.preview_url]?.url" :alt="page.title">
      <p v-else-if="urls[page.preview_url]?.status === 'error'" role="alert">图片加载失败。</p>
      <p v-else role="status">正在加载…</p>
    </figure>
  </div>
</template>
