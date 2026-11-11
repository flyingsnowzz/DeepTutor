<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
interface Totals { total_tokens: number; prompt_tokens: number; completion_tokens: number; cache_hit_rate: number; total_calls: number }
interface ModelUsage { provider: string; model: string; total_tokens: number; prompt_tokens: number; completion_tokens: number; cache_hit_rate: number; total_calls: number; ttft_seconds?: number; tokens_per_second?: number }
interface Day { date: string; total_tokens: number; total_calls: number; turns: number; tracked_turns: number }
interface Usage { year: number; totals: Totals; models: ModelUsage[]; days: Day[]; active_days: number; turns: number; tracked_turns: number; sessions: number }
const route = useRoute(); const router = useRouter()
const currentYear = new Date().getFullYear()
const data = ref<Usage | null>(null)
const loading = ref(true)
const error = ref('')
const selected = ref<Day | null>(null)
const year = computed(() => { const value = Number(route.query.year); return Number.isInteger(value) && value >= 1970 && value <= currentYear ? value : currentYear })
const models = computed(() => data.value?.models.filter(model => model.model) ?? [])
const historical = computed(() => data.value?.models.filter(model => !model.model) ?? [])
const calendar = computed(() => {
  const byDate = new Map((data.value?.days ?? []).map(day => [day.date, day]))
  const start = new Date(Date.UTC(year.value, 0, 1)); const offset = (start.getUTCDay() + 6) % 7
  const dates: Day[] = []
  for (const day = new Date(start); day.getUTCFullYear() === year.value; day.setUTCDate(day.getUTCDate() + 1)) { const date = day.toISOString().slice(0, 10); dates.push(byDate.get(date) ?? { date, total_tokens: 0, total_calls: 0, turns: 0, tracked_turns: 0 }) }
  const weeks: (Day | null)[][] = []
  for (let week = 0; week < Math.ceil((offset + dates.length) / 7); week++) weeks.push(Array.from({ length: 7 }, (_, weekday) => dates[week * 7 + weekday - offset] ?? null))
  return { weeks, dates, offset }
})
const maxTurns = computed(() => Math.max(1, ...calendar.value.dates.map(day => day.turns)))
const months = computed(() => calendar.value.dates.flatMap((day, index) => day.date.endsWith('-01') ? [{ week: Math.floor((index + calendar.value.offset) / 7), label: new Date(`${day.date}T12:00:00Z`).toLocaleDateString('zh-CN', { month: 'short', timeZone: 'UTC' }) }] : []))
const today = new Intl.DateTimeFormat('en-CA').format(new Date())
const n = (value?: number | null) => value == null ? '—' : value.toLocaleString('zh-CN')
const percent = (value?: number | null) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
function level(day: Day) { return day.turns ? Math.min(4, Math.max(1, Math.ceil(day.turns / maxTurns.value * 4))) : 0 }
function dayLabel(day: Day) { return `${day.date} · ${n(day.turns)} 次活动 · ${day.tracked_turns ? n(day.total_tokens) : '—'} tokens` }
function changeYear(next: number) { void router.push({ path: '/settings/usage', query: { year: String(next) } }) }
async function load() { loading.value = true; error.value = ''; try { const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; data.value = await api<Usage>(`/api/settings/usage?year=${year.value}&timezone=${encodeURIComponent(timezone)}`) } catch (cause) { error.value = cause instanceof Error ? cause.message : '用量加载失败' } finally { loading.value = false } }
watch(year, load, { immediate: true })
</script>
<template><div><header class="legacy-settings-page-header"><h1>用量统计</h1><p>查看对话、个性化学习及后台任务的模型用量。</p></header><div class="usage-year-bar"><div><button aria-label="上一年" :disabled="year <= 1970" @click="changeYear(year - 1)"><LegacyIcon name="chevronLeft" :size="15" /></button><strong>{{ year }}</strong><button aria-label="下一年" :disabled="year >= currentYear" @click="changeYear(year + 1)"><LegacyIcon name="chevronRight" :size="15" /></button></div><button class="usage-refresh" aria-label="刷新用量" :disabled="loading" @click="load"><LegacyIcon name="history" :size="15" /></button></div><p v-if="error" class="error" role="alert">无法加载用量统计：{{ error }} <button @click="load">重试</button></p><p v-if="loading && !data" class="legacy-settings-loading">正在加载用量…</p><div v-else-if="data" class="usage-content" :aria-busy="loading"><dl class="usage-summary"><div><dt>总 token 用量</dt><dd>{{ data.tracked_turns ? n(data.totals.total_tokens) : '—' }}</dd></div><div><dt>输入 token</dt><dd>{{ data.tracked_turns ? n(data.totals.prompt_tokens) : '—' }}</dd></div><div><dt>输出 token</dt><dd>{{ data.tracked_turns ? n(data.totals.completion_tokens) : '—' }}</dd></div><div><dt>缓存命中率</dt><dd>{{ percent(data.totals.cache_hit_rate) }}</dd></div></dl><section class="usage-activity"><header><h2>使用活动</h2><span>{{ data.active_days }} 个活跃日 · {{ n(data.turns) }} 次活动</span></header><div class="usage-heatmap-scroll"><div class="usage-heatmap" :style="{ minWidth: `${calendar.weeks.length * 14 + 28}px` }"><div class="usage-months"><span v-for="month in months" :key="month.week" :style="{ left: `${month.week * 14 + 28}px` }">{{ month.label }}</span></div><div class="usage-weekdays"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span></span></div><div class="usage-weeks"><div v-for="(week, weekIndex) in calendar.weeks" :key="weekIndex" class="usage-week"><button v-for="(day, dayIndex) in week" :key="day?.date || dayIndex" :disabled="!day || day.date > today" :aria-label="day ? dayLabel(day) : ''" :aria-pressed="day?.date === selected?.date" :class="day ? `level-${level(day)}` : 'empty'" @mouseenter="day && (selected = day)" @focus="day && (selected = day)" @click="day && (selected = day)"></button></div></div></div></div><footer><p aria-live="polite">{{ selected ? dayLabel(selected) : '每日活动' }}</p><div><span>较少</span><i v-for="index in 5" :key="index" :class="`level-${index - 1}`"></i><span>较多</span></div></footer></section><section class="usage-models"><header><h2>模型用量</h2><span>{{ n(data.totals.total_calls) }} 次 LLM 调用 · {{ n(data.sessions) }} 个会话</span></header><div v-if="models.length" class="usage-table-wrap"><table><thead><tr><th>模型</th><th>总 token</th><th>输入 token</th><th>输出 token</th><th>缓存命中率</th><th>LLM 调用</th><th>TTFT</th><th>TPS</th></tr></thead><tbody><tr v-for="model in models" :key="`${model.provider}:${model.model}`"><th><span>{{ model.model }}</span><small v-if="model.provider">{{ model.provider }}</small></th><td>{{ n(model.total_tokens) }}</td><td>{{ n(model.prompt_tokens) }}</td><td>{{ n(model.completion_tokens) }}</td><td>{{ percent(model.cache_hit_rate) }}</td><td>{{ n(model.total_calls) }}</td><td>{{ model.ttft_seconds == null ? '—' : `${model.ttft_seconds.toFixed(2)} s` }}</td><td>{{ model.tokens_per_second == null ? '—' : `${model.tokens_per_second.toFixed(1)} tok/s` }}</td></tr></tbody></table></div><div v-else class="usage-empty">今年暂无模型用量记录。</div><p v-if="historical.length" class="usage-historical"><span>无法恢复模型详情的历史用量</span><span>{{ n(historical.reduce((sum, model) => sum + model.total_tokens, 0)) }} tokens</span></p></section></div></div></template>
