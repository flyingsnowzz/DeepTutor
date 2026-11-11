<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ANNOTATION_COLORS, type AnnotationColor, type AnnotationKind, type NormalisedRect } from '../readingAnnotations'

const props = defineProps<{
  locator: number
  quote: string
  rects: NormalisedRect[]
  editingId?: string
  initialKind?: AnnotationKind
  initialColor?: string
  initialNote?: string
}>()
const emit = defineEmits<{
  save: [draft: { annotation_id?: string; locator: number; kind: AnnotationKind; color: AnnotationColor; quote: string; note: string; rects: NormalisedRect[] }]
  cancel: []
}>()

const form = reactive({
  kind: (props.initialKind ?? 'highlight') as AnnotationKind,
  color: (ANNOTATION_COLORS.includes(props.initialColor as AnnotationColor) ? props.initialColor : 'yellow') as AnnotationColor,
  note: props.initialNote ?? '',
})
const position = ref({ left: 8, top: 8 })

function save() {
  emit('save', {
    annotation_id: props.editingId,
    locator: props.locator,
    kind: form.kind,
    color: form.color,
    quote: props.quote,
    note: form.note.trim(),
    rects: props.rects,
  })
}
</script>

<template>
  <section class="annotation-popover" :style="position" role="dialog" aria-label="创建批注">
    <header><strong>{{ editingId ? '编辑批注' : '创建批注' }}</strong><button type="button" aria-label="关闭" @click="emit('cancel')">×</button></header>
    <blockquote>{{ quote }}</blockquote>
    <div class="annotation-popover-row">
      <label>类型
        <select v-model="form.kind">
          <option value="highlight">高亮</option>
          <option value="underline">下划线</option>
          <option value="note">笔记</option>
          <option value="citation">引用</option>
        </select>
      </label>
      <fieldset>
        <legend>颜色</legend>
        <button
          v-for="color in ANNOTATION_COLORS"
          :key="color"
          type="button"
          class="annotation-color-swatch"
          :class="{ selected: form.color === color }"
          :data-color="color"
          :aria-label="color"
          :aria-pressed="form.color === color"
          @click="form.color = color"
        />
      </fieldset>
    </div>
    <label class="annotation-note-field">笔记
      <textarea v-model="form.note" rows="3" placeholder="补充说明（可选）" />
    </label>
    <footer>
      <button type="button" @click="emit('cancel')">取消</button>
      <button type="button" class="primary" @click="save">保存</button>
    </footer>
  </section>
</template>

<style scoped>
.annotation-popover{position:absolute;z-index:20;width:min(340px,calc(100% - 16px));display:grid;gap:9px;padding:11px;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:0 16px 40px rgba(0,0,0,.18)}
.annotation-popover header{display:flex;align-items:center;justify-content:space-between;font-size:12px}
.annotation-popover header button{border:0;background:transparent;color:var(--muted-foreground);font-size:18px;cursor:pointer}
.annotation-popover blockquote{margin:0;padding:7px 9px;border-left:3px solid var(--primary);border-radius:0 7px 7px 0;background:var(--muted);color:var(--foreground);font-size:11px;max-height:90px;overflow:auto}
.annotation-popover-row{display:flex;align-items:end;gap:10px;flex-wrap:wrap}
.annotation-popover label{display:grid;gap:4px;color:var(--muted-foreground);font-size:10.5px}
.annotation-popover select,.annotation-popover textarea{width:100%;border:1px solid var(--border);border-radius:7px;padding:6px 8px;background:var(--background);color:var(--foreground);font:inherit;font-size:11px}
fieldset{display:flex;gap:5px;margin:0;padding:0;border:0}
legend{margin-bottom:4px;color:var(--muted-foreground);font-size:10.5px}
.annotation-color-swatch{width:20px;height:20px;border:2px solid transparent;border-radius:50%;cursor:pointer}
.annotation-color-swatch.selected{border-color:var(--foreground)}
.annotation-color-swatch[data-color=yellow]{background:#facd5a}.annotation-color-swatch[data-color=green]{background:#8cdb94}.annotation-color-swatch[data-color=blue]{background:#7ac0fa}.annotation-color-swatch[data-color=pink]{background:#faa1c7}.annotation-color-swatch[data-color=purple]{background:#c7aefa}
.annotation-note-field{display:grid;gap:4px;color:var(--muted-foreground);font-size:10.5px}
.annotation-popover footer{display:flex;justify-content:flex-end;gap:7px}
.annotation-popover footer button{padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:var(--background);color:var(--foreground);font-size:11px;cursor:pointer}
.annotation-popover footer .primary{border-color:var(--primary);background:var(--primary);color:var(--primary-foreground)}
</style>
