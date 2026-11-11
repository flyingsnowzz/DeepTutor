<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { scopedUrl as scopedUrlCalendar } from '../workspaceScope'
import { api, post } from '../api'
import AnchoredPopover, { type PopoverAnchor } from '../components/AnchoredPopover.vue'
import CalendarEventDetails from '../components/CalendarEventDetails.vue'

type Scope = 'this' | 'following' | 'all'
interface Calendar { id: string; name: string; color: string; visible: boolean; is_default: boolean }
interface Event { id: string; event_id: string; occurrence: string; recurring: boolean; calendar_id: string; title: string; notes: string; location: string; all_day: boolean; start: string; end: string; rrule: string | null; color: string | null; reminders?: number[]; task_id?: string; task_workspace_id?: string; source?: string }
interface Task { id: string; title: string; status: 'todo' | 'doing' | 'done'; due_date: string | null; archived: boolean }
interface Layers { reviews: { date: string; mastery: number; practice: number }[]; automations: { id: string; job_id: string; name: string; at: string; enabled: boolean }[]; footprints: { date: string; session_count: number; practice_reviews: number; mastery_evidence: number }[] }
const cursor = ref(new Date())
const view = ref<'day' | 'week' | 'month' | 'agenda'>('month')
const railOpen = ref(true)
const searchOpen = ref(false)
const eventColor = ref('')
const reminders = ref<number[]>([10])
const recurrencePreset = ref('')
const reminderOptions = [0, 5, 10, 15, 30, 60, 120, 1440]
const colorOptions = ['#4f78d8', '#0f8b6c', '#d9730d', '#e03e3e', '#8a5cc2', '#c14c8a', '#2b8bb3', '#c29318', '#787774']
const calendars = ref<Calendar[]>([])
const events = ref<Event[]>([])
const query = ref('')
const hits = ref<{ id: string; title: string; start: string; all_day: boolean }[] | null>(null)
const selectedDay = ref(new Date().toLocaleDateString('en-CA'))
const editing = ref<Event | null>(null)
const detailEvent = ref<Event | null>(null)
const detailAnchor = ref<PopoverAnchor>({ top: 110, left: 280, right: 280, bottom: 140 })
const deleteTarget = ref<Event | null>(null)
const title = ref('')
const notes = ref('')
const location = ref('')
const allDay = ref(false)
const start = ref('')
const end = ref('')
const calendarId = ref('')
const recurrence = ref('')
const scope = ref<Scope>('all')
const calendarName = ref('')
const calendarColor = ref('#4f78d8')
const calendarCreateOpen = ref(false)
const reminderPermission = ref('default')
const layerVisibility = ref({ tasks: true, reviews: true, automations: true, footprints: true })
const error = ref('')
const notice = ref('')
const busy = ref(false)
const layers = ref<Layers>({ reviews: [], automations: [], footprints: [] })
const tasks = ref<Task[]>([])
const detailTask = computed(() => tasks.value.find(task => task.id === detailEvent.value?.task_id))
const undoToken = ref('')
const dragged = ref<{ kind: 'event' | 'task'; id: string } | null>(null)
let stream: EventSource | undefined
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const monthLabel = computed(() => cursor.value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }))
const monthStart = computed(() => new Date(cursor.value.getFullYear(), cursor.value.getMonth(), 1))
const gridStart = computed(() => { const d = new Date(monthStart.value); d.setDate(d.getDate() - d.getDay()); return d })
const weekStart = computed(() => { const d = new Date(cursor.value); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d })
const rangeStart = computed(() => view.value === 'month' ? gridStart.value : view.value === 'week' ? weekStart.value : new Date(cursor.value.getFullYear(), cursor.value.getMonth(), cursor.value.getDate()))
const rangeDayCount = computed(() => view.value === 'month' ? 42 : view.value === 'week' ? 7 : view.value === 'agenda' ? 30 : 1)
const mainDays = computed(() => Array.from({ length: view.value === 'day' ? 1 : view.value === 'week' ? 7 : view.value === 'agenda' ? 30 : 42 }, (_, i) => { const d = new Date(rangeStart.value); d.setDate(d.getDate() + i); return d }))
const weekDayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const viewTitle = computed(() => view.value === 'day' ? cursor.value.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) : view.value === 'week' ? `${weekStart.value.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} – ${mainDays.value[6]?.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}` : monthLabel.value)
const days = computed(() => Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart.value); d.setDate(d.getDate() + i); return d }))
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dateOf = (event: Event) => event.all_day ? event.start.slice(0, 10) : dayKey(new Date(event.start))
const visible = computed(() => events.value.filter(event => calendars.value.find(calendar => calendar.id === event.calendar_id)?.visible !== false))
const selectedEvents = computed(() => visible.value.filter(event => dateOf(event) === selectedDay.value).sort((a, b) => a.start.localeCompare(b.start)))
const grouped = computed(() => {
  const groups = new Map<string, Event[]>()
  for (const event of visible.value) { const key = dateOf(event); groups.set(key, [...(groups.get(key) || []), event]) }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
})
const calendarColorOf = (event: Event) => event.color || calendars.value.find(item => item.id === event.calendar_id)?.color || '#4f78d8'
function localInput(value: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function displayTime(event: Event) { return event.all_day ? '全天' : new Date(event.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
function timedStyle(event: Event) { const from = new Date(event.start); const to = new Date(event.end); const minutes = event.all_day ? 0 : from.getHours() * 60 + from.getMinutes(); const duration = event.all_day ? 30 : Math.max(30, (to.getTime() - from.getTime()) / 60000); return { top: `${minutes / 60 * 56}px`, height: `${Math.max(28, duration / 60 * 56 - 3)}px`, borderColor: calendarColorOf(event) } }
async function load() {
  error.value = ''
  const first = new Date(rangeStart.value)
  const last = new Date(first); last.setDate(last.getDate() + rangeDayCount.value)
  try {
    const [c, e] = await Promise.all([
      api<{ calendars: Calendar[] }>('/api/calendar/calendars'),
      api<{ occurrences: Event[] }>(`/api/calendar/events?${new URLSearchParams({ start: first.toISOString(), end: last.toISOString(), tz })}`),
    ])
    calendars.value = c.calendars; events.value = e.occurrences
    const [layerResult, boardResult] = await Promise.allSettled([api<Layers>(`/api/calendar/layers?${new URLSearchParams({ start: first.toISOString(), end: last.toISOString(), tz })}`), api<{ cards: Task[] }>('/api/task-board')])
    if (layerResult.status === 'fulfilled') layers.value = layerResult.value
    if (boardResult.status === 'fulfilled') tasks.value = boardResult.value.cards
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '日历加载失败' }
}
watch([cursor, view], load)
onMounted(() => {
  if ('Notification' in window) reminderPermission.value = Notification.permission
  void load()
  window.addEventListener('keydown', onCalendarKeydown)
  stream = new EventSource(scopedUrlCalendar('/api/calendar/stream'))
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  stream.onmessage = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void load() }, 250) }
})
onBeforeUnmount(() => { stream?.close(); window.removeEventListener('keydown', onCalendarKeydown); if (searchTimer) clearTimeout(searchTimer) })
async function enableReminders() {
  if (!('Notification' in window)) { reminderPermission.value = 'unsupported'; return }
  reminderPermission.value = await Notification.requestPermission()
}
function closePanels() {
  detailEvent.value = null
  deleteTarget.value = null
  editing.value = null
  start.value = ''
}
function move(direction: number) {
  closePanels()
  const next = new Date(cursor.value)
  if (view.value === 'month') cursor.value = new Date(next.getFullYear(), next.getMonth() + direction, 1)
  else { next.setDate(next.getDate() + direction * (view.value === 'week' ? 7 : view.value === 'agenda' ? 30 : 1)); cursor.value = next }
}
function openDay(day: Date) {
  closePanels()
  selectedDay.value = dayKey(day)
  cursor.value = new Date(day)
  view.value = 'day'
  query.value = ''
}
function onCalendarKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || detailEvent.value || deleteTarget.value || start.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
  const key = event.key.toLowerCase()
  if (key === 't') { cursor.value = new Date(); query.value = ''; event.preventDefault() }
  else if (key === 'c') { newEvent(); event.preventDefault() }
  else if (key === '/') { searchOpen.value = true; void nextTick(() => document.querySelector<HTMLInputElement>('.calendar-top-search input')?.focus()); event.preventDefault() }
  else if (key === 'arrowleft') { move(-1); event.preventDefault() }
  else if (key === 'arrowright') { move(1); event.preventDefault() }
  else if (['d', 'w', 'm', 'a'].includes(key)) {
    view.value = ({ d: 'day', w: 'week', m: 'month', a: 'agenda' } as Record<string, typeof view.value>)[key]
    closePanels()
    event.preventDefault()
  }
}

function selectDay(day: Date) { selectedDay.value = dayKey(day); cursor.value = new Date(day) }
function reminderLabel(minutes: number) { return minutes === 0 ? '日程开始时' : minutes < 60 ? `提前 ${minutes} 分钟` : minutes < 1440 ? `提前 ${minutes / 60} 小时` : `提前 ${minutes / 1440} 天` }
function addReminder() { const next = reminderOptions.find(value => !reminders.value.includes(value)); if (next !== undefined) reminders.value.push(next) }
function newEvent(day?: string, allDayEvent = false) {
  detailEvent.value = null
  deleteTarget.value = null
  editing.value = null; title.value = ''; notes.value = ''; location.value = ''; allDay.value = allDayEvent
  const targetDay = day ?? dayKey(cursor.value)
  if (allDayEvent) {
    start.value = targetDay
    const next = new Date(`${targetDay}T12:00:00`)
    next.setDate(next.getDate() + 1)
    end.value = dayKey(next)
  } else if (day === undefined) {
    const next = new Date()
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    start.value = localInput(next.toISOString())
    const endDate = new Date(next.getTime() + 3600_000)
    end.value = localInput(endDate.toISOString())
  } else {
    start.value = `${targetDay}T09:00`
    end.value = `${targetDay}T10:00`
  }
  recurrence.value = ''; recurrencePreset.value = ''; reminders.value = [10]; eventColor.value = ''; scope.value = 'all'
  calendarId.value = calendars.value.find(item => item.is_default)?.id || calendars.value[0]?.id || ''
}
function createFromMonthCell(day: Date, event: MouseEvent) {
  if ((event.target as HTMLElement).closest('button')) return
  selectedDay.value = dayKey(day)
  cursor.value = new Date(day)
  newEvent(dayKey(day), true)
}
function editEvent(event: Event) {
  editing.value = event; title.value = event.title; notes.value = event.notes; location.value = event.location
  allDay.value = event.all_day; start.value = event.all_day ? event.start.slice(0, 10) : localInput(event.start)
  end.value = event.all_day ? event.end.slice(0, 10) : localInput(event.end)
  calendarId.value = event.calendar_id; recurrence.value = event.rrule || ''; recurrencePreset.value = ['', 'FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=WEEKLY', 'FREQ=MONTHLY', 'FREQ=YEARLY'].includes(event.rrule || '') ? (event.rrule || '') : 'custom'; reminders.value = [...(event.reminders || [])]; eventColor.value = event.color || ''; scope.value = event.recurring ? 'this' : 'all'
}
function anchorOf(target: EventTarget | null): PopoverAnchor {
  if (target instanceof HTMLElement) {
    const rect = target.getBoundingClientRect()
    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom }
  }
  return { top: 110, left: 280, right: 280, bottom: 140 }
}
function openEvent(event: Event, mouseEvent?: MouseEvent) {
  detailEvent.value = event
  detailAnchor.value = anchorOf(mouseEvent?.currentTarget ?? null)
  deleteTarget.value = null
  editing.value = null
  start.value = ''
}
function openEditor(event: Event) {
  editEvent(event)
  detailEvent.value = null
  deleteTarget.value = null
}
function editDetail() { if (detailEvent.value) openEditor(detailEvent.value) }
function duplicateDetail() {
  if (!detailEvent.value) return
  openEditor(detailEvent.value)
  editing.value = null
  recurrence.value = ''
  recurrencePreset.value = ''
  scope.value = 'all'
}
function requestDelete(event: Event) {
  deleteTarget.value = event
  detailEvent.value = null
  editing.value = null
  start.value = ''
  scope.value = event.recurring ? 'this' : 'all'
}
function deleteDetail() { if (detailEvent.value) requestDelete(detailEvent.value) }
async function completeDetailTask() {
  if (!detailTask.value) return
  try {
    await postPatch(`/api/task-board/cards/${encodeURIComponent(detailTask.value.id)}`, { status: 'done' })
    detailEvent.value = null
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新任务失败' }
}
function payload() {
  return { title: title.value.trim(), notes: notes.value, location: location.value, all_day: allDay.value,
    start: allDay.value ? start.value.slice(0, 10) : new Date(start.value).toISOString(),
    end: allDay.value ? end.value.slice(0, 10) : new Date(end.value).toISOString(), tzid: tz,
    calendar_id: calendarId.value || null, color: eventColor.value || null, reminders: [...reminders.value], rrule: (recurrencePreset.value === 'custom' ? recurrence.value.trim() : recurrencePreset.value) || null }
}
async function saveEvent() {
  if (!start.value || !end.value) return
  busy.value = true; error.value = ''
  try {
    const data = payload()
    if (editing.value) await postPatch(`/api/calendar/events/${encodeURIComponent(editing.value.event_id)}`, { changes: data, scope: editing.value.recurring ? scope.value : 'all', occurrence: editing.value.recurring ? editing.value.occurrence : null })
    else await post('/api/calendar/events', data)
    editing.value = null; title.value = ''; start.value = ''; await load(); notice.value = '日程已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存日程失败' }
  finally { busy.value = false }
}
function postPatch(path: string, data: unknown) { return api(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) }
async function deleteEvent() {
  const target = deleteTarget.value
  if (!target) return
  busy.value = true; error.value = ''
  try {
    const params = new URLSearchParams({ scope: target.recurring ? scope.value : 'all' })
    if (target.recurring) params.set('occurrence', target.occurrence)
    const result = await api<{ undo_token?: string }>(`/api/calendar/events/${encodeURIComponent(target.event_id)}?${params}`, { method: 'DELETE' })
    undoToken.value = result.undo_token || ''
    deleteTarget.value = null
    editing.value = null
    start.value = ''
    await load()
    notice.value = '日程已删除'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除日程失败' }
  finally { busy.value = false }
}
async function restoreDeleted() {
  if (!undoToken.value) return
  busy.value = true
  try { await post(`/api/calendar/undo/${encodeURIComponent(undoToken.value)}`, {}); undoToken.value = ''; await load(); notice.value = '已恢复删除的日程' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '恢复失败' }
  finally { busy.value = false }
}
function tasksOn(day: string) { if (!layerVisibility.value.tasks) return []; return tasks.value.filter(task => !task.archived && task.due_date === day) }
function dragEvent(event: Event) { dragged.value = { kind: 'event', id: event.id } }
function dragTask(task: Task) { dragged.value = { kind: 'task', id: task.id } }
async function dropOnDay(day: string) {
  if (!dragged.value) return
  const current = dragged.value
  dragged.value = null
  busy.value = true
  error.value = ''
  try {
    if (current.kind === 'task') {
      await postPatch(`/api/task-board/cards/${encodeURIComponent(current.id)}`, { due_date: day })
      notice.value = '任务截止日期已更新'
    } else {
      const event = events.value.find(item => item.id === current.id)
      if (!event) return
      const from = dateOf(event)
      if (from === day) return
      const daysDelta = Math.round((new Date(`${day}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000)
      const shift = (value: string) => { const date = new Date(value); date.setDate(date.getDate() + daysDelta); return event.all_day ? dayKey(date) : date.toISOString() }
      if (event.recurring) { editEvent(event); start.value = event.all_day ? shift(event.start).slice(0, 10) : localInput(shift(event.start)); end.value = event.all_day ? shift(event.end).slice(0, 10) : localInput(shift(event.end)); scope.value = 'this'; notice.value = '请选择重复日程的修改范围后保存' }
      else { await postPatch(`/api/calendar/events/${encodeURIComponent(event.event_id)}`, { changes: { start: shift(event.start), end: shift(event.end) }, scope: 'all', occurrence: null }); notice.value = '日程已移动' }
    }
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '移动失败' }
  finally { busy.value = false }
}
async function cancelAutomation(jobId: string) {
  if (!confirm('取消这条自动任务？')) return
  try { await api(`/api/calendar/automations/${encodeURIComponent(jobId)}`, { method: 'DELETE' }); layers.value.automations = layers.value.automations.filter(item => item.job_id !== jobId); notice.value = '自动任务已取消' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '取消自动任务失败' }
}
async function createCalendar() {
  if (!calendarName.value.trim()) return
  try { await post('/api/calendar/calendars', { name: calendarName.value.trim(), color: calendarColor.value }); calendarName.value = ''; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '创建日历失败' }
}
async function toggleCalendar(calendar: Calendar) {
  try { await postPatch(`/api/calendar/calendars/${encodeURIComponent(calendar.id)}`, { visible: !calendar.visible }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '更新日历失败' }
}
async function deleteCalendar(calendar: Calendar) {
  if (calendar.is_default || !confirm(`删除日历“${calendar.name}”？`)) return
  try { await api(`/api/calendar/calendars/${encodeURIComponent(calendar.id)}`, { method: 'DELETE' }); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除日历失败' }
}
async function goToHit(hit: { start: string; all_day: boolean }) {
  const day = hit.all_day ? hit.start.slice(0, 10) : dayKey(new Date(hit.start))
  selectedDay.value = day
  cursor.value = new Date(`${day}T12:00:00`)
  view.value = 'day'
  query.value = ''
  searchOpen.value = false
  detailEvent.value = null
  deleteTarget.value = null
  await load()
}
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, value => {
  clearTimeout(searchTimer); hits.value = null
  if (!value.trim()) return
  searchTimer = setTimeout(async () => {
    try { hits.value = (await api<{ events: { id: string; title: string; start: string; all_day: boolean }[] }>(`/api/calendar/search?${new URLSearchParams({ q: value.trim() })}`)).events }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '搜索失败' }
  }, 250)
})
</script>

<template>
  <main class="feature-page calendar-page">
    <header class="feature-heading calendar-page-bar">
      <div class="calendar-bar-leading"><h1>日历</h1><button class="calendar-icon-button" :aria-pressed="railOpen" title="日历侧栏" @click="railOpen = !railOpen">▤</button><button @click="cursor = new Date()">今天</button><button class="calendar-icon-button" aria-label="上一个" @click="move(-1)">‹</button><button class="calendar-icon-button" aria-label="下一个" @click="move(1)">›</button><strong>{{ viewTitle }}</strong></div>
      <div class="calendar-bar-actions"><div class="calendar-top-search"><button v-if="!searchOpen" class="calendar-icon-button" aria-label="搜索日历" title="搜索日历 /" @click="searchOpen = true; query = ''">⌕</button><input v-else v-model="query" autofocus type="search" placeholder="搜索日历" @keydown.esc="searchOpen = false; query = ''"><div v-if="searchOpen && hits" class="calendar-search-results"><button v-for="hit in hits" :key="hit.id" @click="goToHit(hit); searchOpen = false">{{ hit.title || '未命名' }} · {{ hit.start.slice(0, 10) }}</button><p v-if="!hits.length">无匹配结果</p></div></div><div class="calendar-view-tabs" role="tablist" aria-label="日历视图"><button v-for="option in ([['day','日'],['week','周'],['month','月'],['agenda','日程列表']] as const)" :key="option[0]" role="tab" :aria-selected="view === option[0]" :class="{ active: view === option[0] }" @click="view = option[0]">{{ option[1] }}</button></div><button class="primary calendar-new-event" @click="newEvent()"><span>＋</span><span>新建日程</span></button></div>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }} <button v-if="undoToken" @click="restoreDeleted">撤销删除</button></p>
    <div class="calendar-layout" :class="{ 'rail-closed': !railOpen }">
      <aside v-if="railOpen" class="calendar-rail">
        <section class="calendar-mini-month"><header><strong>{{ monthLabel }}</strong><div><button aria-label="上个月" @click="cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)">‹</button><button aria-label="下个月" @click="cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)">›</button></div></header><div class="calendar-mini-grid"><span v-for="day in ['日','一','二','三','四','五','六']" :key="day">{{ day }}</span><button v-for="day in days" :key="dayKey(day)" :class="{ faded: day.getMonth() !== cursor.getMonth(), selected: dayKey(day) === selectedDay }" @click="selectDay(day)">{{ day.getDate() }}</button></div></section>
        <section class="calendar-unscheduled"><header><h2>未安排的任务</h2><a href="/kanban">任务看板</a></header><p v-if="!tasks.filter(task => !task.due_date && task.status !== 'done' && !task.archived).length">所有未完成任务都已安排。</p><button v-for="task in tasks.filter(task => !task.due_date && task.status !== 'done' && !task.archived)" :key="task.id" draggable="true" @dragstart="dragged = { kind: 'task', id: task.id }">{{ task.title }}</button></section>
        <section class="calendar-list-section"><h2>日历列表</h2><div v-for="calendar in calendars" :key="calendar.id" class="calendar-entry"><label><input type="checkbox" :checked="calendar.visible" @change="toggleCalendar(calendar)"><span class="calendar-dot" :style="{ background: calendar.color }">{{ calendar.name || '我的日历' }}</span></label><button v-if="!calendar.is_default" title="删除日历" @click="deleteCalendar(calendar)">×</button><button v-else title="日历选项">⋯</button></div><button v-if="!calendarCreateOpen" type="button" class="calendar-new-calendar" @click="calendarCreateOpen = true">＋ 新建日历</button><form v-else class="calendar-add" @submit.prevent="createCalendar(); calendarCreateOpen = false"><input v-model="calendarName" placeholder="日历名称" maxlength="80" autofocus><input v-model="calendarColor" type="color" aria-label="日历颜色"><button :disabled="!calendarName.trim()">＋</button></form></section>
        <section class="calendar-workspace-layers"><h2>来自当前工作区</h2><label class="calendar-layer-toggle"><input v-model="layerVisibility.tasks" type="checkbox"><span>任务截止日期</span></label><label class="calendar-layer-toggle"><input v-model="layerVisibility.reviews" type="checkbox"><span>待复习内容</span></label><label class="calendar-layer-toggle"><input v-model="layerVisibility.automations" type="checkbox"><span>自动化</span></label><label class="calendar-layer-toggle"><input v-model="layerVisibility.footprints" type="checkbox"><span>学习足迹</span></label></section>
        <details open v-if="layerVisibility.reviews && layers.reviews.length"><summary>复习</summary><div v-for="review in layers.reviews" :key="review.date" class="calendar-layer-row">{{ review.date }} · 路径 {{ review.mastery }} · 练习 {{ review.practice }}</div></details><details open v-if="layerVisibility.automations && layers.automations.length"><summary>自动任务</summary><div v-for="automation in layers.automations" :key="automation.job_id" class="calendar-layer-row"><span>{{ automation.name }}</span><small>{{ automation.at }}</small><button @click="cancelAutomation(automation.job_id)">取消</button></div></details><details open v-if="layerVisibility.footprints && layers.footprints.length"><summary>学习足迹</summary><div v-for="day in layers.footprints" :key="day.date" class="calendar-layer-row">{{ day.date }} · {{ day.session_count }} 段对话 · {{ day.practice_reviews }} 次练习</div></details>
        <div class="calendar-reminder-settings"><button type="button" :disabled="reminderPermission === 'granted' || reminderPermission === 'unsupported'" @click="enableReminders">♧ {{ reminderPermission === 'granted' ? '提醒已开启' : reminderPermission === 'denied' ? '浏览器已阻止提醒' : reminderPermission === 'unsupported' ? '浏览器不支持提醒' : '开启提醒' }}</button><p>DeepTutor 打开时提醒有效。</p></div>
      </aside>
      <section class="calendar-main">
        <div v-if="view === 'month'" class="calendar-grid">
          <div v-for="weekday in weekDayLabels" :key="weekday" class="calendar-weekday">{{ weekday }}</div>
          <div
            v-for="day in days"
            :key="dayKey(day)"
            :data-day="dayKey(day)"
            class="calendar-cell"
            :class="{ faded: day.getMonth() !== cursor.getMonth(), selected: dayKey(day) === selectedDay }"
            @click="createFromMonthCell(day, $event)"
            @dragover.prevent
            @drop.prevent="dropOnDay(dayKey(day))"
          >
            <button type="button" class="calendar-cell-date" @click.stop="openDay(day)">{{ day.getDate() === 1 ? `${day.getMonth() + 1}月1日` : day.getDate() }}</button>
            <button
              v-for="event in visible.filter(item => dateOf(item) === dayKey(day)).slice(0, 3)"
              :key="event.id"
              type="button"
              class="calendar-event-chip"
              draggable="true"
              :style="{ borderColor: calendarColorOf(event) }"
              @click.stop="openEvent(event, $event)"
              @dragstart="dragEvent(event)"
            >{{ displayTime(event) }} {{ event.title || '未命名' }}</button>
            <button v-for="task in tasksOn(dayKey(day))" :key="task.id" type="button" class="calendar-task-chip" draggable="true" @dragstart="dragTask(task)">✓ {{ task.title }}</button>
          </div>
        </div>
        <section v-if="view === 'month'" class="calendar-day-list legacy-compat-dom" aria-hidden="true"><h2>{{ selectedDay }} <button @click="newEvent(selectedDay)">＋</button></h2><button v-for="event in selectedEvents" :key="event.id" @click="openEvent(event, $event)"><span :style="{ background: calendarColorOf(event) }" class="calendar-dot"></span>{{ displayTime(event) }} · {{ event.title || '未命名' }}</button><p v-if="!selectedEvents.length" class="muted">当天暂无日程。</p></section>
        <div v-else-if="view === 'day' || view === 'week'" class="calendar-time-view" :class="`days-${mainDays.length}`"><div class="calendar-time-head"><span></span><button v-for="day in mainDays" :key="dayKey(day)" :class="{ selected: dayKey(day) === selectedDay }" @click="selectDay(day)"><small>{{ weekDayLabels[(day.getDay() + 6) % 7] }}</small>{{ day.getDate() }}</button></div><div class="calendar-time-body"><div class="calendar-hours"><span v-for="hour in 24" :key="hour">{{ String(hour - 1).padStart(2, '0') }}:00</span></div><div v-for="day in mainDays" :key="dayKey(day)" class="calendar-time-column" :data-day="dayKey(day)" @dragover.prevent @drop.prevent="dropOnDay(dayKey(day))"><i v-for="hour in 24" :key="hour"></i><button v-for="event in visible.filter(item => dateOf(item) === dayKey(day))" :key="event.id" class="calendar-timed-event" :style="timedStyle(event)" @click="openEvent(event, $event)"><strong>{{ event.title || '未命名' }}</strong><small>{{ displayTime(event) }}</small></button></div></div></div>
        <div v-else class="calendar-agenda"><section v-for="[day, items] in grouped" :key="day"><h3>{{ new Date(`${day}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) }}</h3><button v-for="event in items" :key="event.id" @click="openEvent(event, $event)"><span :style="{ background: calendarColorOf(event) }" class="calendar-dot"></span>{{ displayTime(event) }} · {{ event.title || '未命名' }}</button></section><p v-if="!grouped.length" class="muted">这段时间暂无日程。</p></div>
      </section>
    </div>
    <AnchoredPopover v-if="detailEvent" :anchor="detailAnchor" :width="350" label="日程详情" @close="detailEvent = null">
      <CalendarEventDetails :event="detailEvent" :calendars="calendars" :task="detailTask" :busy="busy" @edit="editDetail" @duplicate="duplicateDetail" @delete="deleteDetail" @close="detailEvent = null" @complete-task="completeDetailTask" />
    </AnchoredPopover>
    <AnchoredPopover v-if="deleteTarget" :anchor="detailAnchor" :width="350" label="删除日程" @close="deleteTarget = null">
      <div class="calendar-delete-confirm">
        <strong>删除日程？</strong>
        <label v-if="deleteTarget.recurring">操作范围<select v-model="scope" aria-label="操作范围"><option value="this">仅这次</option><option value="following">这次及以后</option><option value="all">全部</option></select></label>
        <footer><button type="button" :disabled="busy" @click="deleteTarget = null">取消</button><button type="button" class="primary" :disabled="busy" @click="deleteEvent">删除</button></footer>
      </div>
    </AnchoredPopover>
    <section v-if="start" class="calendar-editor"><div class="calendar-editor-card"><header><span>{{ editing ? '编辑日程' : '新建日程' }}</span><button aria-label="关闭" @click="start = ''">×</button></header><form class="settings-form" @submit.prevent="saveEvent"><input v-model="title" class="calendar-title-input" placeholder="添加标题" maxlength="200" autofocus><div class="calendar-date-row"><input v-model="start" aria-label="开始" :type="allDay ? 'date' : 'datetime-local'" required><span>→</span><input v-model="end" aria-label="结束" :type="allDay ? 'date' : 'datetime-local'" required></div><div class="calendar-options-row"><label class="calendar-switch"><input v-model="allDay" type="checkbox"><span></span>全天</label><select v-model="recurrencePreset" aria-label="重复"><option value="">不重复</option><option value="FREQ=DAILY">每天</option><option value="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR">每个工作日</option><option value="FREQ=WEEKLY">每周</option><option value="FREQ=MONTHLY">每月</option><option value="FREQ=YEARLY">每年</option><option value="custom">自定义重复</option></select></div><input v-if="recurrencePreset === 'custom'" v-model="recurrence" placeholder="FREQ=WEEKLY;COUNT=4" aria-label="自定义重复规则"><div class="calendar-color-row"><select v-model="calendarId" aria-label="日历"><option v-for="calendar in calendars" :key="calendar.id" :value="calendar.id">{{ calendar.name || '我的日历' }}</option></select><div class="calendar-color-swatches" aria-label="日程颜色"><button v-for="color in colorOptions" :key="color" type="button" :style="{ background: color }" :class="{ selected: eventColor === color || (!eventColor && calendarColorOf({ color: null, calendar_id: calendarId } as Event) === color) }" :aria-label="color" @click="eventColor = color"></button></div></div><input v-model="location" placeholder="添加地点" maxlength="300"><textarea v-model="notes" placeholder="添加说明" rows="2" maxlength="5000"></textarea><div class="calendar-reminders"><span>提醒</span><div v-for="(minutes, index) in reminders" :key="`${minutes}:${index}`" class="calendar-reminder-chip"><select v-model.number="reminders[index]" :aria-label="`提醒 ${index + 1}`"><option v-for="option in reminderOptions" :key="option" :value="option">{{ reminderLabel(option) }}</option></select><button type="button" aria-label="移除提醒" @click="reminders.splice(index, 1)">×</button></div><button type="button" class="calendar-add-reminder" @click="addReminder">＋ 添加提醒</button></div><label v-if="editing?.recurring" class="calendar-scope">操作范围<select v-model="scope"><option value="this">仅这次</option><option value="following">这次及以后</option><option value="all">全部</option></select></label><div class="calendar-editor-actions"><button type="button" @click="start = ''">取消</button><button class="primary" :disabled="busy || !start || !end">保存</button></div></form></div></section>
  </main>
</template>
