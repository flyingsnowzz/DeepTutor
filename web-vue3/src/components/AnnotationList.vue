<script setup lang="ts">
import { computed, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { annotationColor, ANNOTATION_SWATCH, type AnnotationItem } from '../readingAnnotations'

const props = defineProps<{
  annotations: AnnotationItem[]
  activeId?: string | null
}>()
const emit = defineEmits<{
  select: [annotation: AnnotationItem]
  delete: [annotation: AnnotationItem]
}>()
const view = ref<'annotations' | 'citations'>('annotations')
const visible = computed(() =>
  view.value === 'citations'
    ? props.annotations.filter(item => item.kind === 'citation')
    : props.annotations.filter(item => item.kind !== 'citation'),
)
const grouped = computed(() => {
  const map = new Map<number, AnnotationItem[]>()
  for (const item of visible.value) {
    const bucket = map.get(item.locator) ?? []
    bucket.push(item)
    map.set(item.locator, bucket)
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
})
function swatch(item: AnnotationItem) {
  return ANNOTATION_SWATCH[annotationColor(item.color)]
}
</script>

<template>
  <section class="annotation-list">
    <div class="annotation-list-tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="view === 'annotations'" :class="{ active: view === 'annotations' }" @click="view = 'annotations'">批注</button>
      <button type="button" role="tab" :aria-selected="view === 'citations'" :class="{ active: view === 'citations' }" @click="view = 'citations'">引用</button>
    </div>
    <p v-if="!visible.length" class="annotation-list-empty">
      {{ view === 'citations' ? '还没有引用。' : '在文档中选中文字即可高亮或添加笔记。' }}
    </p>
    <ul v-else>
      <template v-for="[locator, items] in grouped" :key="locator">
        <li v-for="item in items" :key="item.annotation_id" class="annotation-list-row" :class="{ active: activeId === item.annotation_id }">
          <button type="button" class="annotation-list-open" @click="emit('select', item)">
            <span class="annotation-list-dot" :style="{ backgroundColor: swatch(item) }" />
            <span class="annotation-list-copy">
              <strong v-if="item.quote">{{ item.quote }}</strong>
              <small v-if="item.note">{{ item.note }}</small>
              <em>第 {{ item.locator }} 页 · {{ item.kind }}{{ item.author === 'assistant' ? ' · AI' : '' }}</em>
            </span>
          </button>
          <button type="button" class="annotation-list-delete" aria-label="删除批注" @click="emit('delete', item)">
            <LegacyIcon name="trash" :size="12" />
          </button>
        </li>
      </template>
    </ul>
  </section>
</template>

<style scoped>
.annotation-list{display:grid;gap:8px;min-height:0}
.annotation-list-tabs{display:flex;gap:4px}
.annotation-list-tabs button{padding:5px 9px;border:1px solid var(--border);border-radius:999px;background:var(--background);color:var(--muted-foreground);font-size:11px;cursor:pointer}
.annotation-list-tabs button.active{border-color:var(--primary);color:var(--primary);background:color-mix(in srgb,var(--primary) 8%,var(--background))}
.annotation-list-empty{margin:0;padding:10px;border:1px dashed var(--border);border-radius:8px;color:var(--muted-foreground);font-size:11px;line-height:1.6}
.annotation-list ul{display:grid;gap:6px;margin:0;padding:0;list-style:none;overflow:auto}
.annotation-list-row{display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:8px;background:var(--background)}
.annotation-list-row.active{border-color:var(--primary)}
.annotation-list-open{display:flex;min-width:0;flex:1;align-items:center;gap:7px;padding:7px;background:transparent;text-align:left;cursor:pointer}
.annotation-list-dot{width:8px;height:8px;flex:0 0 auto;border-radius:50%}
.annotation-list-copy{display:grid;gap:2px;min-width:0}
.annotation-list-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--foreground);font-size:11.5px;font-weight:500}
.annotation-list-copy small{color:var(--muted-foreground);font-size:10.5px}
.annotation-list-copy em{color:var(--muted-foreground);font-size:9.5px;font-style:normal}
.annotation-list-delete{display:inline-flex;padding:6px;border:0;background:transparent;color:var(--muted-foreground);cursor:pointer}
.annotation-list-delete:hover{color:var(--destructive)}
</style>
