<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { renderMarkdownProse } from '../mathMarkdown'
import { parseMarkdownFences, type MarkdownSegment } from '../markdownFences'
import MermaidBlock from './MermaidBlock.vue'
import CodeBlockPreview from './CodeBlockPreview.vue'
import { codeBlockPreferences, loadCodeBlockPreferences } from '../codeBlockPreferences'

const props = withDefaults(defineProps<{ content: string; stripFrontmatter?: boolean }>(), { stripFrontmatter: false })
onMounted(() => { void loadCodeBlockPreferences() })

interface RenderedSegment {
  key: number
  type: 'prose' | 'code'
  html?: string
  code?: string
  language?: string
  isMermaid: boolean
}

const segments = computed<RenderedSegment[]>(() => {
  const source = props.stripFrontmatter
    ? props.content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
    : props.content
  const parsed: MarkdownSegment[] = parseMarkdownFences(source)
  return parsed.map((segment, index) => {
    if (segment.type === 'prose') {
      return {
        key: index,
        type: 'prose' as const,
        isMermaid: false,
        html: renderMarkdownProse(segment.text),
      }
    }
    const block = segment.block
    if (!block) {
      return { key: index, type: 'code' as const, isMermaid: false, html: '' }
    }
    const mermaid = block.isDiagram && block.lang === 'mermaid'
    return {
      key: index,
      type: 'code' as const,
      isMermaid: mermaid,
      code: block.code,
      language: block.lang,
    }
  })
})
</script>

<template>
  <div class="markdown-body">
    <template v-for="segment in segments" :key="segment.key">
      <div v-if="segment.type === 'prose'" v-html="segment.html" />
      <MermaidBlock v-else-if="segment.isMermaid" :code="segment.code || ''" :language="segment.language" />
      <CodeBlockPreview v-else class="markdown-fenced-code" :raw="segment.code || ''" :language="segment.language || 'text'" :theme="codeBlockPreferences.theme" :show-line-numbers="codeBlockPreferences.showLineNumbers" :wrap-long-lines="codeBlockPreferences.wrapLongLines" />
    </template>
  </div>
</template>
