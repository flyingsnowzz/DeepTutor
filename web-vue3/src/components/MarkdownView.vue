<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { parseMarkdownFences, type MarkdownSegment } from '../markdownFences'
import MermaidBlock from './MermaidBlock.vue'

const props = withDefaults(defineProps<{ content: string; stripFrontmatter?: boolean }>(), { stripFrontmatter: false })

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
        html: DOMPurify.sanitize(marked.parse(segment.text, { async: false, gfm: true, breaks: true })),
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
      html: mermaid
        ? ''
        : DOMPurify.sanitize(
            marked.parse('```' + block.lang + '\n' + block.code + '\n```', {
              async: false,
              gfm: true,
              breaks: true,
            }),
          ),
    }
  })
})
</script>

<template>
  <div class="markdown-body">
    <template v-for="segment in segments" :key="segment.key">
      <div v-if="segment.type === 'prose'" v-html="segment.html" />
      <MermaidBlock v-else-if="segment.isMermaid" :code="segment.code || ''" :language="segment.language" />
      <div v-else class="markdown-fenced-code" v-html="segment.html" />
    </template>
  </div>
</template>
