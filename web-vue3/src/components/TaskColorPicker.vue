<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskColors = Record<TaskStatus, string>

const props = withDefaults(defineProps<{
  colors: TaskColors
  error?: string
  disabled?: boolean
  busy?: boolean
}>(), { disabled: false, busy: false })

const emit = defineEmits<{ save: [TaskColors, () => void] }>()

const statuses: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: '待办' },
  { id: 'doing', label: '进行中' },
  { id: 'done', label: '已完成' },
]
const DEFAULT_COLORS: TaskColors = { todo: '#2563eb', doing: '#a16207', done: '#15803d' }
const swatches = [
  '#2563eb', '#4f46e5', '#8b5cf6', '#db2777',
  '#e11d48', '#ea580c', '#0284c7', '#0d9488',
  '#15803d', '#65a30d', '#a16207', '#64748b',
]
const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const activeStatus = ref<TaskStatus>('todo')
const draft = ref<TaskColors>({ ...props.colors })
const hex = ref(props.colors.todo)
let returnFocus: HTMLElement | null = null

const validHex = () => /^#[0-9a-f]{6}$/i.test(hex.value)
const changed = () => statuses.some(({ id }) => draft.value[id].toLowerCase() !== props.colors[id].toLowerCase())

function resetDraft() {
  draft.value = { ...props.colors }
  activeStatus.value = 'todo'
  hex.value = draft.value.todo
}

function resetColors() {
  draft.value = { ...DEFAULT_COLORS }
  hex.value = DEFAULT_COLORS[activeStatus.value]
}

function choose(color: string) {
  draft.value = { ...draft.value, [activeStatus.value]: color }
  hex.value = color
}

function selectStatus(status: TaskStatus) {
  activeStatus.value = status
  hex.value = draft.value[status]
}

function onHexInput(value: string) {
  hex.value = value
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    draft.value = { ...draft.value, [activeStatus.value]: value }
  }
}

function close() {
  if (!props.busy) open.value = false
}

function save() {
  if (!validHex() || !changed()) return
  emit('save', { ...draft.value }, close)
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value || !root.value) return
  if (event.target instanceof Node && !root.value.contains(event.target)) close()
}

function onKeyDown(event: KeyboardEvent) {
  if (!open.value || !root.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(root.value.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.offsetParent !== null)
  if (!focusable.length) {
    event.preventDefault()
    root.value.focus()
    return
  }
  const first = focusable[0]
  const last = focusable.at(-1) ?? first
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.colors, value => {
  draft.value = { ...value }
  hex.value = value[activeStatus.value]
})

watch(open, async isOpen => {
  if (isOpen) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    resetDraft()
    await nextTick()
    root.value?.querySelector<HTMLElement>('[data-modal-initial-focus]')?.focus()
  } else {
    returnFocus?.focus?.()
  }
})

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="task-color-picker">
    <button
      ref="trigger"
      type="button"
      class="task-color-picker-trigger"
      :disabled="disabled || busy"
      :aria-expanded="open"
      aria-haspopup="dialog"
      aria-label="状态颜色"
      @click="open = !open"
    >
      <LegacyIcon name="palette" :size="15" :stroke-width="1.7" />
      <span>状态颜色</span>
      <span class="task-color-picker-dots" aria-hidden="true">
        <i v-for="status in statuses" :key="status.id" :style="{ backgroundColor: colors[status.id] }" />
      </span>
    </button>

    <div
      v-if="open"
      role="dialog"
      aria-label="状态颜色"
      tabindex="-1"
      class="task-color-picker-panel"
      @keydown="onKeyDown"
    >
      <div class="task-color-picker-header">
        <h2>状态颜色</h2>
        <button type="button" aria-label="关闭" :disabled="busy" @click="close"><LegacyIcon name="close" :size="14" :stroke-width="1.7" /></button>
      </div>

      <div class="task-color-picker-body">
        <div class="task-color-status-tabs" role="group" aria-label="状态">
          <button
            v-for="status in statuses"
            :key="status.id"
            type="button"
            :class="{ 'is-active': activeStatus === status.id }"
            :aria-pressed="activeStatus === status.id"
            :data-modal-initial-focus="activeStatus === status.id || undefined"
            :disabled="busy"
            @click="selectStatus(status.id)"
          >
            <i :style="{ backgroundColor: draft[status.id] }" aria-hidden="true" />
            {{ status.label }}
          </button>
        </div>

        <div class="task-color-swatches" role="group" aria-label="选择颜色">
          <button
            v-for="color in swatches"
            :key="color"
            type="button"
            :aria-label="`选择颜色：${color}`"
            :aria-pressed="draft[activeStatus].toLowerCase() === color"
            :disabled="busy"
            @click="choose(color)"
          >
            <i :style="{ backgroundColor: color }" aria-hidden="true" />
          </button>
        </div>

        <div class="task-color-custom">
          <span>自定义</span>
          <label class="task-color-native">
            <i :style="{ backgroundColor: draft[activeStatus] }" aria-hidden="true" />
            <input
              type="color"
              :aria-label="`${statuses.find(item => item.id === activeStatus)?.label}选择颜色`"
              :value="draft[activeStatus]"
              :disabled="busy"
              @input="choose(($event.target as HTMLInputElement).value)"
            >
          </label>
          <input
            v-model="hex"
            class="task-color-hex"
            :aria-label="`${statuses.find(item => item.id === activeStatus)?.label}颜色值`"
            :aria-invalid="!validHex()"
            maxlength="7"
            spellcheck="false"
            :disabled="busy"
            @input="onHexInput(($event.target as HTMLInputElement).value)"
          >
        </div>
        <p v-if="error" class="task-color-error" role="alert">{{ error }}</p>
      </div>

      <footer>
        <button type="button" class="task-color-reset" :disabled="busy" @click="resetColors"><LegacyIcon name="rotateCcw" :size="12" :stroke-width="1.7" />重置</button>
        <button type="button" class="primary task-color-save" :disabled="busy || !validHex() || !changed()" @click="save">保存</button>
      </footer>
    </div>
  </div>
</template>
