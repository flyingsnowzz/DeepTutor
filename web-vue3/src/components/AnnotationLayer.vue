<script setup lang="ts">
import { ANNOTATION_SWATCH, annotationColor, type AnnotationItem, type NormalisedRect } from '../readingAnnotations'

defineProps<{
  annotations: AnnotationItem[]
  highlightedAnnotationId?: string | null
  flashRects?: NormalisedRect[]
}>()
const emit = defineEmits<{ select: [annotation: AnnotationItem] }>()

function swatch(color: string) {
  return ANNOTATION_SWATCH[annotationColor(color)]
}
</script>

<template>
  <div class="annotation-layer" aria-hidden="false">
    <template v-for="annotation in annotations" :key="annotation.annotation_id">
      <button
        v-for="(rect, index) in annotation.rects"
        :key="`${annotation.annotation_id}-${index}`"
        type="button"
        class="annotation-layer-mark"
        :class="[
          annotation.kind === 'underline' ? 'is-underline' : 'is-highlight',
          highlightedAnnotationId === annotation.annotation_id ? 'is-focused' : '',
        ]"
        :style="{
          left: `${rect[0] * 100}%`,
          top: `${rect[1] * 100}%`,
          width: `${Math.max(0, rect[2] - rect[0]) * 100}%`,
          height: `${Math.max(0, rect[3] - rect[1]) * 100}%`,
          ...(annotation.kind === 'underline'
            ? { borderBottomColor: swatch(annotation.color) }
            : { backgroundColor: swatch(annotation.color) }),
        }"
        :aria-label="annotation.note || annotation.quote || annotation.kind"
        :title="annotation.note || annotation.quote || annotation.kind"
        @click.stop="emit('select', annotation)"
      >
        <span v-if="annotation.author === 'assistant' && index === 0" class="annotation-layer-ai-dot" aria-hidden="true" />
      </button>
    </template>
    <span
      v-for="(rect, index) in flashRects ?? []"
      :key="`flash-${index}`"
      class="annotation-layer-flash"
      :style="{
        left: `${rect[0] * 100}%`,
        top: `${rect[1] * 100}%`,
        width: `${Math.max(0, rect[2] - rect[0]) * 100}%`,
        height: `${Math.max(0, rect[3] - rect[1]) * 100}%`,
      }"
    />
  </div>
</template>

<style scoped>
.annotation-layer{position:absolute;inset:0;pointer-events:none;z-index:2}
.annotation-layer-mark{position:absolute;margin:0;padding:0;border:0;background:transparent;pointer-events:auto;cursor:pointer;border-radius:2px}
.annotation-layer-mark.is-highlight{mix-blend-mode:multiply;opacity:.6}
.annotation-layer-mark.is-underline{background:transparent;border-bottom:2px solid transparent}
.annotation-layer-mark.is-focused{opacity:.9;outline:2px solid var(--primary);outline-offset:1px}
.annotation-layer-ai-dot{position:absolute;top:-3px;right:-3px;width:6px;height:6px;border-radius:50%;background:var(--primary);box-shadow:0 0 0 1px var(--background)}
.annotation-layer-flash{position:absolute;border-radius:2px;background:color-mix(in srgb,var(--primary) 28%,transparent);animation:annotation-flash 1.4s ease-out forwards}
@keyframes annotation-flash{to{opacity:0}}
</style>
