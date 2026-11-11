<script setup lang="ts">
import { computed, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'

export interface ContextTreeItem {
  key: string
  icon: string
  kind: string
  label: string
  thumbnailUrl?: string
  previewable?: boolean
}

const props = withDefaults(defineProps<{
  items: ContextTreeItem[]
  direction?: 'up' | 'down'
  align?: 'left' | 'right'
  summaryNoun?: string
}>(), {
  direction: 'up',
  align: 'left',
  summaryNoun: '项引用',
})
const emit = defineEmits<{
  preview: [item: ContextTreeItem]
  remove: [item: ContextTreeItem]
}>()
const expanded = ref(false)

const collapsible = computed(() => props.items.length > 1)
const visible = computed(() =>
  !collapsible.value || expanded.value ? props.items : [],
)
const mirrored = computed(() => props.align === 'right')
</script>

<template>
  <div v-if="items.length" class="context-reference-tree" :class="[`is-${direction}`, `align-${align}`]">
    <template v-if="direction === 'up'">
      <div
        v-for="item in visible"
        :key="item.key"
        class="context-reference-row"
        :class="{ mirrored }"
      >
        <span class="context-reference-elbow" aria-hidden="true" />
        <button v-if="item.previewable !== false" type="button" class="context-reference-open" :aria-label="`查看 ${item.kind} ${item.label}`" @click="emit('preview', item)">
          <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="">
          <LegacyIcon v-else :name="item.icon" :size="13" />
          <strong>{{ item.kind }}</strong>
          <span>{{ item.label }}</span>
        </button>
        <span v-else class="context-reference-open is-static">
          <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="">
          <LegacyIcon v-else :name="item.icon" :size="13" />
          <strong>{{ item.kind }}</strong>
          <span>{{ item.label }}</span>
        </span>
        <button type="button" class="context-reference-remove" :aria-label="`移除 ${item.label}`" @click="emit('remove', item)">×</button>
      </div>
      <button v-if="collapsible" type="button" class="context-reference-summary" :aria-expanded="expanded" @click="expanded = !expanded">
        <LegacyIcon v-if="!expanded" name="more" :size="12" />
        <span v-else class="context-reference-fold-spacer" aria-hidden="true" />
        <span>{{ expanded ? '收起' : `${items.length} ${summaryNoun}` }}</span>
        <LegacyIcon name="chevronDown" :size="11" :class="{ expanded }" />
      </button>
    </template>
    <template v-else>
      <button v-if="collapsible" type="button" class="context-reference-summary" :aria-expanded="expanded" @click="expanded = !expanded">
        <LegacyIcon v-if="!expanded" name="more" :size="12" />
        <span v-else class="context-reference-fold-spacer" aria-hidden="true" />
        <span>{{ expanded ? '收起' : `${items.length} ${summaryNoun}` }}</span>
        <LegacyIcon name="chevronDown" :size="11" :class="{ expanded }" />
      </button>
      <div
        v-for="item in visible"
        :key="item.key"
        class="context-reference-row"
        :class="{ mirrored }"
      >
        <span class="context-reference-elbow" aria-hidden="true" />
        <button v-if="item.previewable !== false" type="button" class="context-reference-open" :aria-label="`查看 ${item.kind} ${item.label}`" @click="emit('preview', item)">
          <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="">
          <LegacyIcon v-else :name="item.icon" :size="13" />
          <strong>{{ item.kind }}</strong>
          <span>{{ item.label }}</span>
        </button>
        <span v-else class="context-reference-open is-static">
          <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="">
          <LegacyIcon v-else :name="item.icon" :size="13" />
          <strong>{{ item.kind }}</strong>
          <span>{{ item.label }}</span>
        </span>
        <button type="button" class="context-reference-remove" :aria-label="`移除 ${item.label}`" @click="emit('remove', item)">×</button>
      </div>
    </template>
  </div>
</template>
