<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { blocksToHtml, htmlToBlocks, type NoteBlock } from '../notes/noteBlocks'

const props = withDefaults(defineProps<{ blocks: NoteBlock[]; documentId?: string; epoch?: number; syncScrollEnabled?: boolean; showPreview?: boolean }>(), { documentId: '', epoch: 0, syncScrollEnabled: true, showPreview: true })
type ToolbarItem = { id: string; title: string; icon: string; separator?: boolean; action?: () => void }
function insertOpaqueBlock(type: string, props: Record<string, unknown>, text: string) {
  insertBlock({ id: crypto.randomUUID(), type, props, content: [{ type: 'text', text }], children: [] })
}
function insertMermaid() {
  const code = 'flowchart TD\n  A[Start] --> B[End]'
  insertOpaqueBlock('mermaid', { code }, code)
}
function insertMath() {
  insertOpaqueBlock('math', { formula: 'a^2 + b^2 = c^2' }, 'a^2 + b^2 = c^2')
}
function insertImage() {
  insertOpaqueBlock('image', { url: 'https://', alt: 'alt' }, 'alt')
}
function insertTable() {
  const markdown = '| Column | Column |\n| ------ | ------ |\n| Cell | Cell |'
  insertOpaqueBlock('table', { markdown }, markdown)
}
const toolbarItems: ToolbarItem[] = [
  { id: 'undo', title: '撤销', icon: '↶', action: () => editor.value?.chain().focus().undo().run() },
  { id: 'redo', title: '重做', icon: '↷', action: () => editor.value?.chain().focus().redo().run() },
  { id: 'sep-1', title: '', icon: '', separator: true },
  { id: 'h1', title: '一级标题', icon: 'H1', action: () => editor.value?.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', title: '二级标题', icon: 'H2', action: () => editor.value?.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3', title: '三级标题', icon: 'H3', action: () => editor.value?.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: 'h4', title: '四级标题', icon: 'H4', action: () => editor.value?.chain().focus().toggleHeading({ level: 4 }).run() },
  { id: 'h5', title: '五级标题', icon: 'H5', action: () => editor.value?.chain().focus().toggleHeading({ level: 5 }).run() },
  { id: 'h6', title: '六级标题', icon: 'H6', action: () => editor.value?.chain().focus().toggleHeading({ level: 6 }).run() },
  { id: 'sep-2', title: '', icon: '', separator: true },
  { id: 'bold', title: '粗体', icon: 'B', action: () => editor.value?.chain().focus().toggleBold().run() },
  { id: 'italic', title: '斜体', icon: 'I', action: () => editor.value?.chain().focus().toggleItalic().run() },
  { id: 'strike', title: '删除线', icon: 'S', action: () => editor.value?.chain().focus().toggleStrike().run() },
  { id: 'code', title: '行内代码', icon: '</>', action: () => editor.value?.chain().focus().toggleCode().run() },
  { id: 'sep-3', title: '', icon: '', separator: true },
  { id: 'quote', title: '引用', icon: '❝', action: () => editor.value?.chain().focus().toggleBlockquote().run() },
  { id: 'ul', title: '项目列表', icon: '•', action: () => editor.value?.chain().focus().toggleBulletList().run() },
  { id: 'ol', title: '编号列表', icon: '1.', action: () => editor.value?.chain().focus().toggleOrderedList().run() },
  { id: 'task', title: '任务列表', icon: '☑', action: () => editor.value?.chain().focus().toggleTaskList().run() },
  { id: 'sep-4', title: '', icon: '', separator: true },
  { id: 'hr', title: '水平分割线', icon: '―', action: () => editor.value?.chain().focus().setHorizontalRule().run() },
  { id: 'table', title: '表格', icon: '▦', action: insertTable },
  { id: 'link', title: '链接', icon: '↗', action: setLink },
  { id: 'image', title: '图片', icon: '▧', action: insertImage },
  { id: 'sep-5', title: '', icon: '', separator: true },
  { id: 'codeblock', title: '代码块', icon: '{ }', action: () => editor.value?.chain().focus().toggleCodeBlock().run() },
  { id: 'mermaid', title: 'Mermaid 图表', icon: '⌘', action: insertMermaid },
  { id: 'math', title: '数学块', icon: 'Σ', action: insertMath },
]

const newType = ref<'math' | 'flashcards' | 'quiz'>('math')
const customText = ref('')
const emit = defineEmits<{ 'update:blocks': [blocks: NoteBlock[]]; change: []; select: [id: string]; toggleSync: [] }>()
const OpaqueBlock = Node.create({
  name: 'noteOpaque', group: 'block', atom: true, selectable: true, draggable: false,
  addAttributes() { return { blockId: { default: '' }, label: { default: '保留块' }, text: { default: '' }, blockType: { default: 'paragraph' }, props: { default: '{}' }, content: { default: '[]' } } },
  parseHTML() { return [{ tag: 'div[data-note-opaque]', getAttrs: element => ({ blockId: (element as HTMLElement).dataset.noteOpaque, label: (element as HTMLElement).dataset.label, text: (element as HTMLElement).textContent, blockType: (element as HTMLElement).dataset.blockType, props: (element as HTMLElement).dataset.props, content: (element as HTMLElement).dataset.content }) }] },
  renderHTML({ node }) { return ['div', mergeAttributes({ 'data-note-opaque': node.attrs.blockId, 'data-label': node.attrs.label, 'data-block-type': node.attrs.blockType, 'data-props': node.attrs.props, 'data-content': node.attrs.content, class: 'note-opaque-block' }), `［${node.attrs.label}］${node.attrs.text}`] },
})
const BlockIds = Extension.create({
  name: 'noteBlockIds',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading', 'bulletListItem', 'orderedListItem', 'taskItem', 'blockquote', 'codeBlock'], attributes: { blockId: { default: '', parseHTML: element => element.getAttribute('data-block-id') || '', renderHTML: attributes => attributes.blockId ? { 'data-block-id': attributes.blockId } : {} } } }] },
})
let lastHtml = ''
const editor = useEditor({
  extensions: [StarterKit, Link.configure({ openOnClick: false }), TaskList, TaskItem, OpaqueBlock, BlockIds],
  content: blocksToHtml(props.blocks),
  editorProps: { attributes: { class: 'rich-note-content', 'aria-label': '富文本页面内容' } },
  onSelectionUpdate() {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const element = anchor instanceof Element ? anchor : anchor?.parentElement
    const block = element?.closest('[data-block-id], [data-note-opaque]') as HTMLElement | null
    const id = block?.dataset.blockId || block?.dataset.noteOpaque
    if (id) emit('select', id)
  },
  onUpdate({ editor }) {
    lastHtml = editor.getHTML()
    emit('update:blocks', htmlToBlocks(lastHtml, props.blocks))
    emit('change')
  },
})
watch(() => [props.documentId, props.epoch], () => {
  if (!editor.value) return
  const html = blocksToHtml(props.blocks)
  if (html !== editor.value.getHTML()) { lastHtml = html; editor.value.commands.setContent(html, { emitUpdate: false }) }
})
onBeforeUnmount(() => editor.value?.destroy())
function insertBlock(block: NoteBlock) { editor.value?.commands.insertContent(blocksToHtml([block])) }
function insertCustomBlock() {
  const id = crypto.randomUUID()
  const text = customText.value.trim()
  if (newType.value === 'math') insertBlock({ id, type: 'math', props: { formula: text || 'x^2' }, content: [], children: [] })
  else if (newType.value === 'flashcards') { const [front, back] = text.split('|'); insertBlock({ id, type: 'learning', props: { kind: 'flashcards', data: JSON.stringify({ cards: [{ front: front || 'Front', back: back || 'Back' }] }) }, content: [], children: [] }) }
  else if (newType.value === 'quiz') insertBlock({ id, type: 'learning', props: { kind: 'quiz', data: JSON.stringify({ questions: [{ question_id: `${id}:1`, question: text || 'Question', options: { A: 'Option A', B: 'Option B' }, correct_answer: 'A', explanation: '' }] }) }, content: [], children: [] })
  customText.value = ''
}
defineExpose({ insertBlock })
function setLink() {
  // The legacy editor inserts a markdown link snippet rather than opening a
  // browser prompt. Keep the same toolbar action in the rich-text editor.
  editor.value?.chain().focus().insertContent('[text](https://)').run()
}
</script>

<template>
  <section v-if="editor" class="rich-note-editor dt-note-editor">
    <div class="rich-note-toolbar" role="toolbar" aria-label="富文本工具">
      <div class="rich-note-toolbar-main">
      <template v-for="item in toolbarItems" :key="item.id">
        <span v-if="item.separator" class="rich-note-toolbar-separator" aria-hidden="true" />
        <button v-else type="button" :aria-label="item.title" :title="item.title" @click="item.action?.()"><span aria-hidden="true">{{ item.icon }}</span></button>
      </template>
      </div>
      <div class="rich-note-toolbar-meta"><button type="button" class="rich-note-sync-scroll" :aria-pressed="syncScrollEnabled" :disabled="!showPreview" @click="emit('toggleSync')"><span aria-hidden="true">●</span>同步滚动</button><span>GFM</span><span>KaTeX</span><span>Mermaid</span></div>
    </div><div class="special-block-inserter"><select v-model="newType" aria-label="特殊块类型"><option value="math">公式</option><option value="flashcards">记忆卡</option><option value="quiz">测验</option></select><input v-model="customText" aria-label="特殊块内容" placeholder="公式、正反面或问题"><button type="button" @click="insertCustomBlock">插入特殊块</button></div>
    <EditorContent :editor="editor" />
  </section>
</template>
