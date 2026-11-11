<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import PracticeTrendChart from '../components/PracticeTrendChart.vue'
import {
  practiceTimezone,
  type PracticeAnalytics,
  type PracticeChartStyle,
  type PracticeMetric,
} from '../practice'

const props = defineProps<{ revision?: number }>()
const route = useRoute()
const router = useRouter()
const metrics: { key: PracticeMetric; label: string; color: string }[] = [
  { key: 'questions', label: '新增题目', color: '#4f70d9' },
  { key: 'mistakes', label: '新增错题', color: '#d08732' },
  { key: 'reviews', label: '复习提交', color: '#329080' },
]
const sourceNames: Record<string, string> = {
  mastery_path: '掌握路径',
  book: '图书',
  deep_question: '深度提问',
  immersive_reading: '沉浸阅读',
  partner_chat: '伙伴对话',
  import: '导入',
}

const days = computed(() => {
  const value = Number(route.query.stats_days)
  return [7, 30, 90].includes(value) ? value : 30
})
const metric = computed<PracticeMetric>(() => {
  const value = String(route.query.stats_metric || '')
  return ['questions', 'mistakes', 'reviews'].includes(value) ? (value as PracticeMetric) : 'questions'
})
const chart = computed<PracticeChartStyle>(() =>
  route.query.stats_chart === 'bars' ? 'bars' : 'line',
)
const data = ref<PracticeAnalytics | null>(null)
const loadedDays = ref<number | null>(null)
const loading = ref(true)
const error = ref('')
const retry = ref(0)
let requestVersion = 0

const active = computed(
  () => metrics.find(item => item.key === metric.value) || metrics[0]!,
)
const visibleData = computed(() =>
  data.value && loadedDays.value === days.value ? data.value : null,
)
const total = computed(() => visibleData.value?.totals[metric.value] || 0)
const sources = computed(() =>
  [...(visibleData.value?.sources || [])]
    .filter(source => source[metric.value] > 0)
    .sort((a, b) => b[metric.value] - a[metric.value]),
)

async function load() {
  const version = ++requestVersion
  const requestedDays = days.value
  loading.value = true
  try {
    const next = await api<PracticeAnalytics>(
      `/api/question-notebook/practice/analytics?timezone=${encodeURIComponent(practiceTimezone())}&days=${requestedDays}`,
    )
    if (version !== requestVersion) return
    data.value = next
    loadedDays.value = requestedDays
    error.value = ''
  } catch (cause) {
    if (version === requestVersion) {
      error.value = cause instanceof Error ? cause.message : '统计加载失败'
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

watch([days, () => props.revision, retry], load, { immediate: true })

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (!document.hidden) void load()
  }, 60000)
  window.addEventListener('focus', load)
})
onUnmounted(() => {
  requestVersion++
  if (timer) clearInterval(timer)
  window.removeEventListener('focus', load)
})

function setView(key: string, value: string) {
  void router.replace({ path: route.path, query: { ...route.query, [key]: value } })
}

function number(value: number) {
  return value.toLocaleString('zh-CN')
}

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  })
}

function percentage(value: number) {
  return total.value ? Math.round((value / total.value) * 100) : 0
}

function sourceName(source: string) {
  return sourceNames[source] || '其他'
}
</script>

<template>
  <section class="practice-insights" aria-label="练习活动">
    <header class="practice-insights-header">
      <div>
        <h2>练习活动</h2>
        <p>
          {{ visibleData ? `${dateLabel(visibleData.start_date)} — ${dateLabel(visibleData.end_date)}` : '每日活动与题目来源' }}
        </p>
      </div>
      <div class="practice-insights-controls">
        <select
          :value="days"
          aria-label="统计周期"
          @change="setView('stats_days', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="value in [7, 30, 90]" :key="value" :value="value">最近 {{ value }} 天</option>
        </select>
        <div role="group" aria-label="图表样式">
          <button
            type="button"
            :aria-pressed="chart === 'line'"
            aria-label="折线图"
            @click="setView('stats_chart', 'line')"
          >折线</button>
          <button
            type="button"
            :aria-pressed="chart === 'bars'"
            aria-label="柱状图"
            @click="setView('stats_chart', 'bars')"
          >柱状</button>
        </div>
      </div>
    </header>

    <div class="practice-metrics" role="group" aria-label="练习指标">
      <button
        v-for="item in metrics"
        :key="item.key"
        type="button"
        :aria-pressed="metric === item.key"
        @click="setView('stats_metric', item.key)"
      >
        <span :style="{ background: item.color }" aria-hidden="true" />
        {{ item.label }}
        <strong>{{ visibleData ? number(visibleData.totals[item.key]) : '—' }}</strong>
      </button>
    </div>

    <p v-if="error" role="alert" class="error practice-insights-error">
      {{ visibleData ? '统计刷新失败，当前显示上次加载的数据。' : '统计加载失败。' }} {{ error }}
      <button type="button" @click="retry++">重试</button>
    </p>

    <div v-if="visibleData" class="practice-chart-layout">
      <div class="practice-chart-panel">
        <PracticeTrendChart
          :rows="visibleData.daily"
          :metric="metric"
          :color="active.color"
          :label="active.label"
          :style="chart"
        />
      </div>
      <aside class="practice-source-panel">
        <div class="practice-source-heading">
          <h3>本周期来源</h3>
          <span>{{ active.label }}</span>
        </div>
        <p v-if="!sources.length">本周期无活动</p>
        <div v-for="source in sources" :key="source.source" class="practice-source">
          <div>
            <span>{{ sourceName(source.source) }}</span>
            <strong>{{ number(source[metric]) }}<small>{{ percentage(source[metric]) }}%</small></strong>
          </div>
          <div class="practice-source-track">
            <i
              :style="{
                width: `${percentage(source[metric])}%`,
                background: active.color,
              }"
            />
          </div>
        </div>
      </aside>
    </div>

    <div v-else-if="loading" role="status" class="practice-insights-empty">正在加载统计…</div>
    <div v-else class="practice-insights-empty">统计暂不可用</div>

    <footer class="practice-insights-note">
      <p>新增错题按每道题首次答错的日期计一次；复习提交按已保存的评分记录计；已删除题目不计入统计。</p>
      <details v-if="visibleData">
        <summary>查看每日数据</summary>
        <div class="practice-data-table">
          <table>
            <caption class="legacy-sr-only">每日练习数据</caption>
            <thead>
              <tr>
                <th scope="col">日期</th>
                <th v-for="item in metrics" :key="item.key" scope="col">{{ item.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in visibleData.daily" :key="row.date">
                <th scope="row">{{ row.date }}</th>
                <td v-for="item in metrics" :key="item.key">{{ number(row[item.key]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </footer>
  </section>
</template>
