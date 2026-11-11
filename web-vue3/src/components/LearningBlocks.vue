<script setup lang="ts">
import { reactive } from 'vue'
import { post } from '../api'
import type { NoteBlock } from '../notes/noteBlocks'

const props = defineProps<{ blocks: NoteBlock[]; documentId: string; documentTitle: string }>()
const emit = defineEmits<{ updateBlock: [block: NoteBlock]; error: [message: string] }>()
const answers = reactive<Record<string, string>>({})
const results = reactive<Record<string, boolean | null>>({})
const revealed = reactive<Record<string, boolean>>({})
function payload(block: NoteBlock) {
  try { return JSON.parse(String(block.props.data || '{}')) } catch { return {} }
}
function learningBlocks(kind: string) { return props.blocks.filter(block => block.type === 'learning' && block.props.kind === kind) }
function mediaBlocks(type: string) { return props.blocks.filter(block => block.type === type) }
function mediaUrl(block: NoteBlock) { const value = String(block.props.url || ''); return value.startsWith('/') ? value : /^https?:\/\//.test(value) ? value : '' }
async function answer(block: NoteBlock, question: any, index: number) {
  const questionId = question.question_id || `${block.id}:${index + 1}`
  const answer = answers[questionId]
  if (!answer) return
  const correct = String(question.correct_answer || '') === answer
  results[questionId] = correct
  const data = payload(block)
  const attempts = (Array.isArray(data.attempts) ? data.attempts : []).filter((attempt: any) => attempt.question_id !== questionId)
  attempts.push({ block_id: block.id, page_id: `/co-writer/${props.documentId}`, question_id: questionId, user_answer: answer, is_correct: correct, timestamp: Date.now() / 1000 })
  emit('updateBlock', { ...block, props: { ...block.props, data: JSON.stringify({ ...data, attempts }) } })
  try {
    await post('/api/question-notebook/entries/upsert', {
      origin_type: 'document_analysis', origin_ref: `/co-writer/${props.documentId}#${block.id}`, question_id: questionId,
      question: String(question.question || ''), options: question.options || {}, correct_answer: String(question.correct_answer || ''),
      explanation: String(question.explanation || ''), user_answer: answer, is_correct: correct, material_title: props.documentTitle,
    })
  } catch (cause) { emit('error', cause instanceof Error ? cause.message : '保存答题记录失败') }
}
</script>

<template>
  <section v-for="block in mediaBlocks('image')" :key="block.id" class="learning-special-block"><img :src="mediaUrl(block)" :alt="String(block.props.caption || block.props.name || '图片')"></section><section v-for="block in mediaBlocks('audio')" :key="block.id" class="learning-special-block"><audio :src="mediaUrl(block)" controls /></section><section v-for="block in mediaBlocks('video')" :key="block.id" class="learning-special-block"><video :src="mediaUrl(block)" controls /></section><section v-for="block in mediaBlocks('file')" :key="block.id" class="learning-special-block"><a :href="mediaUrl(block)" target="_blank" rel="noopener">{{ block.props.name || block.props.caption || '附件' }}</a></section><section v-for="block in learningBlocks('flashcards')" :key="block.id" class="learning-special-block"><h3>记忆卡</h3><article v-for="(card, index) in payload(block).cards || []" :key="index"><button @click="revealed[`${block.id}:${index}`] = !revealed[`${block.id}:${index}`]"><strong>{{ card.front }}</strong><p v-if="revealed[`${block.id}:${index}`]">{{ card.back }}</p><small v-else>显示答案</small></button></article></section>
  <section v-for="block in learningBlocks('quiz')" :key="block.id" class="learning-special-block"><h3>测验</h3><fieldset v-for="(question, index) in payload(block).questions || []" :key="question.question_id || `${block.id}:${index + 1}`"><legend>{{ question.question }}</legend><label v-for="(value, key) in question.options || {}" :key="key"><input v-model="answers[question.question_id || `${block.id}:${index + 1}`]" type="radio" :name="`${block.id}:${index}`" :value="key">{{ key }}. {{ value }}</label><button @click="answer(block, question, index)">提交答案</button><p v-if="results[question.question_id || `${block.id}:${index + 1}`] !== undefined">{{ results[question.question_id || `${block.id}:${index + 1}`] ? '回答正确' : '还需再练习' }}</p></fieldset></section>
</template>
