<script setup lang="ts">
import { computed } from 'vue'

export interface CalendarEvent {
  id: string
  event_id: string
  occurrence: string
  recurring: boolean
  calendar_id: string
  title: string
  notes: string
  location: string
  all_day: boolean
  start: string
  end: string
  rrule: string | null
  color: string | null
  reminders?: number[]
  task_id?: string
  task_workspace_id?: string
  source?: string
}
export interface CalendarEntry { id: string; name: string; color: string; visible: boolean; is_default: boolean }
export interface CalendarTask { id: string; title: string; status: 'todo' | 'doing' | 'done'; note?: string }
const props = defineProps<{ event: CalendarEvent; calendars: CalendarEntry[]; task?: CalendarTask; busy?: boolean }>()
const emit = defineEmits<{ edit: []; duplicate: []; delete: []; close: []; completeTask: [] }>()
const calendar = computed(() => props.calendars.find(item => item.id === props.event.calendar_id))
const when = computed(() => {
  const start = new Date(props.event.start)
  const end = new Date(props.event.end)
  const date = start.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  if (props.event.all_day) {
    const endDate = end.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
    return props.event.start.slice(0, 10) === props.event.end.slice(0, 10) ? `${date} · 全天` : `${date} – ${endDate} · 全天`
  }
  return `${date} · ${start.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
})
const repeatText = computed(() => {
  const rule = props.event.rrule || ''
  if (!rule) return ''
  if (rule === 'FREQ=DAILY') return '每天重复'
  if (rule === 'FREQ=WEEKLY') return '每周重复'
  if (rule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return '每个工作日重复'
  if (rule === 'FREQ=MONTHLY') return '每月重复'
  if (rule === 'FREQ=YEARLY') return '每年重复'
  return `重复规则：${rule}`
})
function reminderLabel(minutes: number) {
  if (minutes === 0) return '日程开始时'
  if (minutes < 60) return `提前 ${minutes} 分钟`
  if (minutes < 1440) return `提前 ${minutes / 60} 小时`
  return `提前 ${minutes / 1440} 天`
}
</script>

<template>
  <div class="calendar-event-detail">
    <div class="calendar-detail-actions">
      <button type="button" aria-label="编辑日程" title="编辑日程" :disabled="busy" @click="emit('edit')">✎</button>
      <button type="button" aria-label="复制" title="复制" :disabled="busy" @click="emit('duplicate')">⧉</button>
      <button type="button" aria-label="删除日程" title="删除日程" :disabled="busy" @click="emit('delete')">⌫</button>
      <button type="button" aria-label="关闭" title="关闭" @click="emit('close')">×</button>
    </div>
    <div class="calendar-detail-head">
      <span class="calendar-detail-square" :style="{ backgroundColor: event.color || calendar?.color || '#4f78d8' }" aria-hidden="true" />
      <div><h3>{{ event.title || '未命名' }}</h3><p>{{ when }}</p></div>
    </div>
    <div v-if="repeatText" class="calendar-detail-row"><span aria-hidden="true">↻</span><div>{{ repeatText }}</div></div>
    <div v-if="event.location" class="calendar-detail-row"><span aria-hidden="true">⌖</span><div>{{ event.location }}</div></div>
    <div v-if="event.task_id" class="calendar-detail-row">
      <span aria-hidden="true">{{ task?.status === 'done' ? '✓' : '○' }}</span>
      <div class="calendar-detail-task"><span>{{ task ? `“${task.title}”的时间块` : '另一个工作区任务的时间块' }}</span><button v-if="task && task.status !== 'done'" type="button" class="calendar-detail-text-button" :disabled="busy" @click="emit('completeTask')">标记完成</button></div>
    </div>
    <div v-if="event.notes" class="calendar-detail-row"><span aria-hidden="true">☰</span><p class="calendar-detail-notes">{{ event.notes }}</p></div>
    <div v-if="event.reminders?.length" class="calendar-detail-row"><span aria-hidden="true">♧</span><div>{{ event.reminders.map(reminderLabel).join(' · ') }}</div></div>
    <div v-if="calendar" class="calendar-detail-row"><span aria-hidden="true">▣</span><div class="calendar-detail-calendar"><i :style="{ backgroundColor: calendar.color }" />{{ calendar.name || '我的日历' }}</div></div>
    <div v-if="event.source === 'dito'" class="calendar-detail-row"><span aria-hidden="true">✦</span><div>由 Dito 安排</div></div>
  </div>
</template>
