<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'

defineProps<{ embedded?: boolean }>()

interface Progress { material_id: string; furthest_percentage: number }
interface Activity { activity_id: string; material_id: string; action: string; extension_id: string; locator: number }
interface Records { progress: Progress[]; activities: Activity[] }
const records = ref<Records | null>(null)
const titles = ref<Record<string, string>>({})
const error = ref('')
async function load() {
  error.value = ''
  try { records.value = await api<Records>('/api/mastery-paths/reading/records') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '学习进度加载失败' }
  try { titles.value = Object.fromEntries((await api<{ materials: { material_id: string; title: string }[] }>('/api/reading/library/materials')).materials.map(item => [item.material_id, item.title])) }
  catch { /* Progress remains usable without titles. */ }
}
onMounted(load)
const percent = (value: number) => Math.round(value * 100)
</script>

<template>
  <main class="feature-page progress-page" :class="{ 'progress-embedded': embedded }"><header class="feature-heading"><div><h1>学习进度</h1><p>查看自己的阅读进度和学习活动。</p></div><button @click="load">刷新</button></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-else-if="!records" class="muted">加载中…</p><p v-else-if="!records.progress.length && !records.activities.length" class="muted">暂无学习活动。</p><template v-else-if="records"><div class="partner-grid"><div class="partner-card"><small>资料</small><strong>{{ records.progress.length }}</strong></div><div class="partner-card"><small>最近学习活动</small><strong>{{ records.activities.length }}</strong></div></div><section><h2>阅读进度</h2><p v-if="!records.progress.length" class="muted">暂无阅读进度。</p><div v-for="item in records.progress" :key="item.material_id" class="reading-create progress-item"><div><strong>{{ titles[item.material_id] || item.material_id }}</strong><span>{{ percent(item.furthest_percentage) }}%</span></div><progress :value="Math.min(100, Math.max(0, percent(item.furthest_percentage)))" max="100" :aria-label="`${titles[item.material_id] || item.material_id} 的阅读进度`" /></div></section><section><h2>最近学习活动</h2><p v-if="!records.activities.length" class="muted">暂无学习活动。</p><div v-for="item in records.activities" :key="item.activity_id" class="reading-create progress-item"><strong>{{ titles[item.material_id] || item.material_id }}</strong><p>{{ item.action }} · {{ item.extension_id }} · 位置 {{ item.locator }}</p></div></section></template></main>
</template>
