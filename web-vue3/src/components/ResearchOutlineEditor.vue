<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import type { OutlineItem } from '../research'
import {
  addOutlineItem,
  canConfirmOutline,
  confirmButtonLabel,
  displayedOutline,
  isDisplayCollapsed,
  isOutlineLocked,
  nextCollapsed,
  outlineStatusLabel,
  removeOutlineItem,
  updateOutlineItem,
  type OutlineStatus,
} from '../researchOutline'

const props = defineProps<{
  outline: OutlineItem[]
  topic: string
  status?: OutlineStatus
}>()
const emit = defineEmits<{ confirm: [OutlineItem[]] }>()

const items = ref<OutlineItem[]>([])
const localConfirmed = ref(false)
const collapsed = ref(false)
const userToggled = ref(false)

watch(
  () => props.outline,
  outline => {
    items.value = outline.map(item => ({ ...item }))
  },
  { immediate: true, deep: true },
)

const locked = computed(() => isOutlineLocked(props.status, localConfirmed.value))
const displayCollapsed = computed(() =>
  isDisplayCollapsed(locked.value, userToggled.value, collapsed.value),
)
const validItems = computed(() => displayedOutline(locked.value, props.outline, items.value))
const canConfirm = computed(() => canConfirmOutline(items.value))
const statusInfo = computed(() => outlineStatusLabel(props.status, localConfirmed.value))
const confirmText = computed(() => confirmButtonLabel(props.status))

function toggleCollapsed() {
  if (!locked.value) return
  const next = nextCollapsed(locked.value, userToggled.value, collapsed.value)
  userToggled.value = true
  collapsed.value = next
}

function edit(index: number, field: keyof OutlineItem, event: Event) {
  const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value
  items.value = updateOutlineItem(items.value, index, field, value)
}

function remove(index: number) {
  if (items.value.length <= 1) return
  items.value = removeOutlineItem(items.value, index)
}

function add() {
  items.value = addOutlineItem(items.value)
}

function confirm() {
  if (!canConfirm.value) return
  localConfirmed.value = true
  emit('confirm', items.value.filter(item => item.title.trim()))
}
</script>

<template>
  <section class="research-outline">
    <button
      type="button"
      class="research-outline-head"
      :disabled="!locked"
      :aria-expanded="!displayCollapsed"
      @click="toggleCollapsed"
    >
      <span class="research-outline-head-main">
        <LegacyIcon v-if="locked" name="chevronDown" :size="12" :class="{ 'is-collapsed': displayCollapsed }" />
        <h3>研究大纲</h3>
        <small v-if="displayCollapsed && validItems.length">· {{ validItems.length }} 个子主题</small>
      </span>
      <span v-if="statusInfo" class="research-outline-status" :class="`is-${statusInfo.tone}`">
        <LegacyIcon :name="statusInfo.spinner ? 'loader' : statusInfo.tone === 'danger' ? 'close' : 'check'" :size="12" :class="{ 'is-spinning': statusInfo.spinner }" />
        {{ statusInfo.text }}
      </span>
    </button>
    <p v-if="!locked && !collapsed" class="research-outline-hint">
      检查并编辑下方子主题后开始研究；也可以直接在对话中输入以重新生成大纲。
    </p>

    <template v-if="!displayCollapsed">
      <div class="research-outline-list">
        <div v-for="(item, index) in validItems" :key="index" class="research-outline-row">
          <span class="research-outline-index">{{ index + 1 }}</span>
          <div v-if="locked" class="research-outline-static">
            <div class="research-outline-title">{{ item.title }}</div>
            <div v-if="item.overview" class="research-outline-overview">{{ item.overview }}</div>
          </div>
          <div v-else class="research-outline-edit">
            <input
              type="text"
              :value="item.title"
              placeholder="子主题标题…"
              aria-label="子主题标题"
              @input="edit(index, 'title', $event)"
            >
            <textarea
              :value="item.overview"
              rows="1"
              placeholder="研究方向与重点…"
              aria-label="子主题说明"
              @input="edit(index, 'overview', $event)"
            />
          </div>
          <button
            v-if="!locked && items.length > 1"
            type="button"
            class="research-outline-remove"
            aria-label="删除子主题"
            @click="remove(index)"
          >
            <LegacyIcon name="trash" :size="12" />
          </button>
        </div>
      </div>

      <footer v-if="!locked" class="research-outline-foot">
        <button type="button" class="research-outline-add" @click="add">
          <LegacyIcon name="plus" :size="12" /> 添加子主题
        </button>
        <button type="button" class="research-outline-start" :disabled="!canConfirm" @click="confirm">
          <LegacyIcon name="play" :size="11" /> {{ confirmText }}
        </button>
      </footer>
    </template>
  </section>
</template>
