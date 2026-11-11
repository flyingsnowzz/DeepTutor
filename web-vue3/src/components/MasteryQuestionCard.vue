<script setup lang="ts">
import { computed, reactive } from 'vue'
import MarkdownView from './MarkdownView.vue'
import type { MasteryGrade, MasteryQuestion } from '../masteryQuestions'

const props = withDefaults(defineProps<{ question: MasteryQuestion; grade?: MasteryGrade | null; grades?: Map<string, MasteryGrade>; answered?: boolean; skipped?: boolean; busy?: boolean }>(), { grade: null, grades: undefined, answered: false, skipped: false, busy: false })
const emit = defineEmits<{ answer: [value: { questionId: string; text: string; answers: Array<{ questionId: string; text: string }> }]; skip: [questionId: string]; challenge: [questionId: string] }>()
const answers = reactive<Record<string, string>>({})
const freeSelected = reactive<Record<string, boolean>>({})
const parts = computed(() => props.question.questions || [props.question])
const isGroup = computed(() => Boolean(props.question.questions?.length))
const settled = computed(() => props.skipped || (!isGroup.value && Boolean(props.grade) && props.grade?.final !== false) || ((props.answered || Boolean(props.grade)) && props.grade?.complete !== false && props.grade?.final !== false))
const drafted = computed(() => parts.value.filter(part => answers[part.questionId]?.trim()))
const canSubmit = computed(() => !props.busy && !settled.value && drafted.value.length > 0 && (isGroup.value || drafted.value.length === 1))
function gradeFor(questionId: string) { return props.grades?.get(questionId) || (!isGroup.value ? props.grade : props.grade?.results?.find(item => item.questionId === questionId)) || null }
function difficulty(value: string) { return ({ easy: '基础', medium: '适中', hard: '挑战' } as Record<string, string>)[value] || value }
function optionState(partId: string, label: string) {
  const grade = gradeFor(partId)
  if (grade && grade.result !== 'ungraded') {
    if (label && label === grade.correctLabel) return 'correct'
    if (label && label === grade.learnerAnswer && !grade.isCorrect) return 'wrong'
  }
  return !freeSelected[partId] && answers[partId] === label ? 'picked' : 'idle'
}
function submit() {
  if (!canSubmit.value) return
  const selected = drafted.value.map(part => ({ questionId: part.questionId, text: answers[part.questionId].trim() }))
  emit('answer', { questionId: props.question.questionId, text: selected.map((item, index) => isGroup.value ? `${index + 1}. ${item.text}` : item.text).join('\n'), answers: selected })
}
</script>

<template>
  <section class="mastery-question-group" :aria-label="question.prompt">
    <MarkdownView v-if="isGroup && question.prompt" class="mastery-question-group-title" :content="question.prompt" />
    <div v-for="part in parts" :key="part.questionId" class="mastery-question-card" :class="{ correct: gradeFor(part.questionId)?.isCorrect === true && gradeFor(part.questionId)?.result !== 'ungraded', wrong: gradeFor(part.questionId)?.isCorrect === false && gradeFor(part.questionId)?.result !== 'ungraded', skipped }">
      <div v-if="part.objectiveName || part.difficulty || part.attempt > 1" class="mastery-question-meta">{{ [part.objectiveName, difficulty(part.difficulty), part.attempt > 1 ? `第 ${part.attempt} 次尝试` : ''].filter(Boolean).join(' · ') }}</div>
      <MarkdownView class="mastery-question-prompt" :content="part.prompt" />
      <div v-if="part.visual" class="mastery-question-visual">
        <p>{{ gradeFor(part.questionId)?.independent === false || part.visual.hintsUsed || part.visual.answerCues !== 'none' ? '引导式视觉练习，不代表已独立掌握。' : '基于原始资料的视觉练习。' }}</p>
        <p v-if="part.visual.keyStatus !== 'verified'">参考答案尚未验证，本题不会计入掌握度。</p>
        <p v-if="part.visual.pixelsInspected === false">当前模型尚未验证原始图片，请重新取图后再评分。</p>
        <figure v-for="(source, index) in part.visual.sources" :key="`${source.imageUrl}-${index}`"><a :href="source.imageUrl" target="_blank" rel="noreferrer"><img :src="source.imageUrl" alt="原始资料证据"></a><figcaption><a :href="source.url" target="_blank" rel="noreferrer">{{ source.sourcePath }}{{ source.page ? ` · 第 ${source.page} 页` : '' }}</a></figcaption></figure>
      </div>
      <div v-if="part.options.length" class="mastery-question-options">
        <button v-for="(option, index) in part.options" :key="`${option.label}-${index}`" type="button" class="mastery-question-option" :class="optionState(part.questionId, option.label)" :disabled="busy || settled" @click="freeSelected[part.questionId] = false; answers[part.questionId] = option.label"><span>{{ option.label || String.fromCharCode(65 + index) }}</span><div>{{ option.body }}</div></button>
      </div>
      <div v-if="part.allowFreeText && !settled" class="mastery-question-free">
        <textarea v-if="freeSelected[part.questionId] || !part.options.length" v-model="answers[part.questionId]" :aria-label="part.prompt" :rows="part.options.length ? 2 : 3" :disabled="busy" placeholder="写下你的答案…" />
        <button v-else type="button" :disabled="busy" @click="freeSelected[part.questionId] = true; answers[part.questionId] = ''"><span>＋</span>用自己的话回答</button>
      </div>
      <div v-if="gradeFor(part.questionId)" class="mastery-question-grade">
        <div><strong :class="{ ungraded: gradeFor(part.questionId)?.result === 'ungraded' }">{{ gradeFor(part.questionId)?.result === 'ungraded' ? '未评分 · 掌握度不变' : gradeFor(part.questionId)?.result === 'partial' ? '部分正确' : gradeFor(part.questionId)?.isCorrect ? '回答正确' : '还差一点' }}</strong><span v-if="!gradeFor(part.questionId)?.isCorrect && gradeFor(part.questionId)?.correctLabel && gradeFor(part.questionId)?.result !== 'ungraded'"> · 答案：{{ gradeFor(part.questionId)?.correctLabel }}</span></div>
        <MarkdownView v-if="gradeFor(part.questionId)?.explanation" :content="gradeFor(part.questionId)?.explanation || ''" />
        <MarkdownView v-if="gradeFor(part.questionId)?.feedback && gradeFor(part.questionId)?.feedback !== gradeFor(part.questionId)?.explanation" :content="gradeFor(part.questionId)?.feedback || ''" />
        <button type="button" @click="emit('challenge', part.questionId)">复核或质疑这次评估</button>
      </div>
    </div>
    <div class="mastery-question-footer">
      <span>{{ busy ? '正在发送答案…' : parts.some(part => part.options.length) ? '选择你认为正确的选项。' : '写下答案后继续。' }}</span>
      <div v-if="!settled"><button type="button" :disabled="busy" @click="emit('skip', question.questionId)">跳过此题</button><button type="button" class="primary" :disabled="!canSubmit" @click="submit">提交</button></div>
      <p v-else-if="skipped">已跳过，本题不会记录作答次数。</p><p v-else-if="!grade">答案已提交，导师正在检查。</p>
    </div>
  </section>
</template>
