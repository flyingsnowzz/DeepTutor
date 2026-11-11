<script setup lang="ts">
import { computed } from 'vue'
import { activityDetail, labelTurnEvent } from '../turnActivity'

interface TurnActivityEvent {
  type: string
  content?: string
  message?: string
  stage?: string
}

const props = defineProps<{ events: TurnActivityEvent[] }>()

interface Row {
  type: string
  label: string
  tone: string
  detail: string
}

const rows = computed<Row[]>(() =>
  props.events.map(event => {
    const meta = labelTurnEvent(event.type)
    const detail = activityDetail(event) || (event.stage ? `阶段：${event.stage}` : '')
    return { type: event.type, label: meta.label, tone: meta.tone, detail }
  }),
)
</script>

<template>
  <details v-if="rows.length" class="turn-activity">
    <summary>当前活动（{{ rows.length }}）</summary>
    <ul class="turn-activity-list">
      <li v-for="(row, index) in rows" :key="`${row.type}-${index}`" class="turn-activity-row" :class="`tone-${row.tone}`">
        <span class="turn-activity-dot" aria-hidden="true" />
        <span class="turn-activity-label">{{ row.label }}</span>
        <code v-if="false" class="turn-activity-type">{{ row.type }}</code>
        <span v-if="row.detail" class="turn-activity-detail">{{ row.detail }}</span>
      </li>
    </ul>
  </details>
</template>
