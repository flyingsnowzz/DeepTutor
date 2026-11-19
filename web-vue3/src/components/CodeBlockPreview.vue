<script setup lang="ts">
import { computed } from 'vue'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markup'
import themes from './codeBlockPrismThemes.json'

const props = withDefaults(defineProps<{ raw: string; language?: string; theme: string; showLineNumbers: boolean; wrapLongLines: boolean }>(), { language: 'python' })
type ThemeStyle = Record<string, string | number>
type Theme = Record<string, ThemeStyle>
type Segment = { text: string; style: ThemeStyle }
const theme = computed<Theme>(() => (themes as Record<string, Theme>)[props.theme] ?? (themes as Record<string, Theme>).oneDark)
const baseStyle = computed(() => {
  const pre = theme.value['pre[class*="language-"]'] ?? {}
  const code = theme.value['code[class*="language-"]'] ?? {}
  return { background: String(pre.background ?? pre.backgroundColor ?? '#1f2937'), color: String(code.color ?? pre.color ?? '#e5e7eb') }
})
function segments(tokens: Array<string | Prism.Token>, inherited: ThemeStyle = {}): Segment[] {
  return tokens.flatMap(token => {
    if (typeof token === 'string') return [{ text: token, style: inherited }]
    const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : []
    const style = { ...inherited, ...theme.value[token.type], ...aliases.reduce((result, alias) => ({ ...result, ...theme.value[alias] }), {}) }
    const content = token.content
    return typeof content === 'string' ? [{ text: content, style }] : segments(Array.isArray(content) ? content : [content], style)
  })
}
const language = computed(() => props.language.toLowerCase())
const grammar = computed(() => Prism.languages[language.value] ?? Prism.languages[({ js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', html: 'markup' } as Record<string, string>)[language.value]])
const lines = computed(() => props.raw.replace(/\n$/, '').split('\n').map(line => grammar.value ? segments(Prism.tokenize(line, grammar.value)) : [{ text: line, style: {} }]))
</script>

<template>
  <div class="code-block-preview" :style="baseStyle">
    <div v-if="language && !['text', 'txt', 'plain', 'plaintext', 'none'].includes(language)" class="code-block-language">{{ language }}</div>
    <pre :class="{ wrap: wrapLongLines }"><code><span v-for="(line, index) in lines" :key="index" class="code-block-line"><span v-if="showLineNumbers" class="code-block-number">{{ index + 1 }}</span><span class="code-block-content"><span v-for="(segment, segmentIndex) in line" :key="segmentIndex" :style="segment.style">{{ segment.text }}</span>{{ line.length ? '' : ' ' }}</span></span></code></pre>
  </div>
</template>

<style scoped>
.code-block-preview{overflow:hidden;border:1px solid var(--border);border-radius:12px}.code-block-language{padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;font-weight:500;letter-spacing:.08em;opacity:.8}.code-block-preview pre{margin:0;padding:16px;overflow-x:auto;font:14px/1.7 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre;tab-size:4}.code-block-preview pre.wrap{overflow-x:hidden;white-space:pre-wrap;overflow-wrap:anywhere}.code-block-line{display:block}.code-block-number{display:inline-block;width:2.5em;margin-right:1em;text-align:right;opacity:.5;user-select:none}.code-block-content{white-space:inherit;overflow-wrap:inherit}
</style>
