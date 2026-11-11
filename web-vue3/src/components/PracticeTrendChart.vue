<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import {
  activePracticePoint,
  practiceChartGeometry,
  type PracticeChartStyle,
  type PracticeDailyCounts,
  type PracticeMetric,
} from '../practice'

const props = defineProps<{
  rows: PracticeDailyCounts[]
  metric: PracticeMetric
  color: string
  label: string
  style: PracticeChartStyle
}>()

const titleId = useId()
const selectedDate = ref('')
const geometry = computed(() => practiceChartGeometry(props.rows, props.metric, 600))
const active = computed(() =>
  activePracticePoint(props.rows, props.metric, geometry.value, selectedDate.value),
)

watch(
  () => props.rows,
  rows => {
    selectedDate.value = rows.at(-1)?.date || ''
  },
  { immediate: true },
)

function dateLabel(date: string): string {
  if (!date) return ''
  return new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  })
}

function inspect(index: number) {
  const row = props.rows[index]
  if (row) selectedDate.value = row.date
}

function onKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !props.rows.length) return
  event.preventDefault()
  const delta = event.key === 'ArrowLeft' ? -1 : 1
  inspect(Math.max(0, Math.min(props.rows.length - 1, active.value.index + delta)))
}
</script>

<template>
  <div class="practice-trend">
    <div class="practice-trend-active">
      <span>{{ dateLabel(active.row?.date || '') }}</span>
      <strong>{{ label }} <b>{{ active.row?.[metric] ?? 0 }}</b></strong>
    </div>
    <div
      tabindex="0"
      role="group"
      aria-label="每日趋势图。使用左右方向键查看日期。"
      class="practice-trend-focus"
      @keydown="onKeydown"
    >
      <svg
        role="img"
        :viewBox="`0 0 600 184`"
        :aria-labelledby="titleId"
        class="practice-trend-svg"
      >
        <title :id="titleId">{{ label }}每日趋势，精确数值见每日数据表。</title>
        <g v-for="value in geometry.ticks" :key="value">
          <line
            :x1="geometry.left"
            :x2="geometry.right"
            :y1="geometry.bottom - (value / geometry.top) * geometry.height"
            :y2="geometry.bottom - (value / geometry.top) * geometry.height"
            class="practice-trend-gridline"
            :stroke-dasharray="value ? '3 4' : undefined"
          />
          <text
            :x="geometry.left - 9"
            :y="geometry.bottom - (value / geometry.top) * geometry.height + 4"
            text-anchor="end"
            class="practice-trend-axis"
          >{{ value }}</text>
        </g>
        <template v-if="geometry.points.length">
          <template v-if="style === 'line'">
            <path :d="geometry.areaPath" :fill="color" opacity="0.055" />
            <path
              :d="geometry.linePath"
              fill="none"
              :stroke="color"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
            <circle
              v-for="(point, pointIndex) in geometry.points"
              v-show="rows.length <= 7"
              :key="point.date"
              :cx="point.x"
              :cy="point.y"
              :r="3.5"
              :fill="color"
              :opacity="pointIndex === active.index ? 1 : 0.82"
            />
          </template>
          <rect
            v-for="(bar, barIndex) in geometry.bars"
            v-show="style === 'bars'"
            :key="bar.date"
            :x="bar.x - bar.width / 2"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            rx="2"
            :fill="color"
            :opacity="barIndex === active.index ? 1 : 0.68"
          />
          <line
            :x1="active.point?.x ?? 0"
            :x2="active.point?.x ?? 0"
            y1="16"
            :y2="geometry.bottom"
            :stroke="color"
            opacity="0.25"
            stroke-dasharray="3 3"
          />
          <circle
            v-if="active.point"
            :cx="active.point.x"
            :cy="active.point.y"
            r="3.5"
            :fill="color"
            class="practice-trend-dot"
          />
          <text
            v-for="dateIndex in geometry.dateIndexes"
            :key="dateIndex"
            :x="dateIndex === 0 ? geometry.left : dateIndex === rows.length - 1 ? geometry.right : geometry.points[dateIndex]?.x"
            y="178"
            :text-anchor="dateIndex === 0 ? 'start' : dateIndex === rows.length - 1 ? 'end' : 'middle'"
            class="practice-trend-axis"
          >{{ dateLabel(rows[dateIndex]?.date || '') }}</text>
          <rect
            v-for="(point, pointIndex) in geometry.points"
            :key="`hit-${point.date}`"
            :x="geometry.left + pointIndex * geometry.unit"
            y="0"
            :width="geometry.unit"
            :height="geometry.bottom"
            fill="transparent"
            tabindex="-1"
            @pointermove="inspect(pointIndex)"
            @click="inspect(pointIndex)"
          >
            <title>{{ point.date }}：{{ point.value }}</title>
          </rect>
        </template>
      </svg>
    </div>
  </div>
</template>
