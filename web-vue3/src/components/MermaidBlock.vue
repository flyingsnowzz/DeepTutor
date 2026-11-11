<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { isDiagramLang } from '../markdownFences'

const props = defineProps<{ code: string; language?: string }>()

const container = ref<HTMLElement | null>(null)
const failed = ref(false)
const renderId = `mmd-${Math.random().toString(36).slice(2, 10)}`
let renderSeq = 0

const isMermaid = () => isDiagramLang(props.language || '') || /^\s*(graph|sequenceDiagram|flowchart|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/.test(props.code)

async function render() {
  if (!container.value || !isMermaid()) return
  failed.value = false
  const seq = ++renderSeq
  try {
    // Lazy-load so the ~100KB mermaid bundle stays out of the initial chunk.
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
    const { svg, bindFunctions } = await mermaid.render(renderId, props.code)
    if (seq !== renderSeq || !container.value) return
    container.value.innerHTML = svg
    bindFunctions?.(container.value)
  } catch (cause) {
    if (seq !== renderSeq) return
    failed.value = true
  }
}

watch(() => props.code, render, { immediate: true })
onBeforeUnmount(() => { renderSeq++ })
</script>

<template>
  <div class="mermaid-block">
    <div v-if="!failed" ref="container" class="mermaid-svg" aria-label="Mermaid 图表" />
    <pre v-else class="mermaid-fallback"><code>{{ code }}</code></pre>
  </div>
</template>
