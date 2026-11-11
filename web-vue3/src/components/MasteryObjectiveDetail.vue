<script setup lang="ts">
import { computed } from 'vue'
import LegacyIcon from './LegacyIcon.vue'

interface ObjectiveAttempt { question_id?: string; prompt?: string; answer?: string; is_correct?: boolean; independent?: boolean; at?: number; created_at?: number; feedback?: string }
interface ObjectiveReview { due_at: number | null; stability: number; retrievability: number; lapse_count: number; forgetting_risk: number; reason?: string }
interface ObjectiveEvidence { timestamp: number; turn_id?: string; result: string; assessment_type: string; quality: number | null; hints_used?: number; visual_context?: { task?: string } }
interface ObjectiveError { id?: string; error_type?: string; message?: string; retries?: number; status?: string }
export interface MasteryObjectiveReport {
  id: string; name: string; type: string; module_name: string; status: string; mastery: number; threshold: number; mastered: boolean; assessed_mastered: boolean; mastery_source: string; override_note: string; explanation: string; correct_count: number
  gate?: 'quantitative' | 'qualitative'
  attempts?: ObjectiveAttempt[]
  review?: ObjectiveReview | null
  evidence?: ObjectiveEvidence[]
  evidence_count?: number
  errors?: ObjectiveError[]
  explained?: { summary: string; timestamp?: number }
  required_visual_tasks?: string[]
  demonstrated_visual_tasks?: string[]
}
const props = defineProps<{ report: MasteryObjectiveReport }>()
const attempts = computed(() => props.report.attempts || [])
const evidence = computed(() => props.report.evidence || [])
const errors = computed(() => props.report.errors || [])
const qualitative = computed(() => props.report.gate === 'qualitative')
const percentage = computed(() => qualitative.value ? (props.report.mastered ? 100 : 0) : Math.round(props.report.mastery * 100))
const thresholdPercentage = computed(() => Math.round(props.report.threshold * 100))
const perfectBelowGate = computed(() => props.report.gate !== 'qualitative' && attempts.value.length > 0 && props.report.correct_count === attempts.value.length && props.report.mastery < props.report.threshold)
function relative(timestamp?: number) {
  if (!timestamp) return ''
  const seconds = Math.round(timestamp - Date.now() / 1000)
  const absolute = Math.abs(seconds)
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
  if (absolute < 60) return formatter.format(seconds, 'second')
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), 'minute')
  if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), 'hour')
  return formatter.format(Math.round(seconds / 86400), 'day')
}
function absolute(timestamp: number) { return new Date(timestamp * 1000).toLocaleString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function resultLabel(value: string) { return ({ correct: '正确', incorrect: '错误', partial: '部分正确' } as Record<string, string>)[value] || value }
function assessmentLabel(value: string) { return ({ quiz: '练习', qualitative: '定性评估', review: '复习' } as Record<string, string>)[value] || value }
</script>

<template>
  <div class="mastery-objective-detail">
    <div class="mastery-objective-gate">
      <div><span>{{ qualitative ? '定性门槛：用自己的话解释' : `定量门槛：${thresholdPercentage}%` }}</span><strong :class="{ mastered: report.mastered }">{{ percentage }}%</strong></div>
      <div class="mastery-objective-gate-track"><i :class="{ mastered: report.mastered }" :style="{ width: `${percentage}%` }" /><span v-if="!qualitative" :style="{ left: `${thresholdPercentage}%` }" /></div>
      <p v-if="perfectBelowGate">即使目前 {{ report.correct_count }}/{{ attempts.length }} 次答对，掌握度还会综合证据数量、难度和近期稳定性。再进行一次有区分度的练习，掌握度可能继续提高。</p>
      <p v-else-if="qualitative && !report.mastered && attempts.length">练习题不会直接打开这道门槛；当你用自己的话解释概念、并由导师记录后才会通过。这里的回答仍会计为练习。</p>
    </div>

    <div v-if="report.review" class="mastery-objective-row-detail"><span>间隔复习</span><div>{{ report.review.due_at ? `${relative(report.review.due_at)}到期 · ${absolute(report.review.due_at)}` : '尚未安排' }}<small>记忆保持 {{ Math.round(report.review.retrievability * 100) }}% · 稳定度 {{ report.review.stability.toFixed(1) }} 天</small><small>遗忘风险 {{ Math.round(report.review.forgetting_risk * 100) }}% · {{ report.review.lapse_count }} 次遗忘</small><small v-if="report.review.reason">{{ report.review.reason }}</small></div></div>
    <div v-if="qualitative && report.explanation" class="mastery-objective-row-detail"><span>你的解释</span><div><em>{{ report.explanation }}</em></div></div>

    <section v-if="attempts.length" class="mastery-objective-attempts"><h5>作答记录（{{ report.correct_count }}/{{ attempts.length }} 次正确）</h5><ul><li v-for="(attempt, index) in [...attempts].reverse()" :key="`${attempt.question_id}-${index}`"><LegacyIcon :name="attempt.is_correct ? 'check' : 'close'" :size="12" :class="attempt.is_correct ? 'correct' : 'wrong'" /><div><p>{{ attempt.prompt || '（题目不可用）' }}</p><span>你的回答：{{ attempt.answer || '（空白）' }}<small>{{ relative(attempt.at ?? attempt.created_at) }}</small></span></div></li></ul></section>
    <div v-if="errors.length" class="mastery-objective-row-detail"><span>错因诊断</span><div><span v-for="(error, index) in errors" :key="error.id || index" class="mastery-objective-error">{{ error.error_type || error.message }}{{ error.retries ? ` · 重试 ${error.retries} 次` : '' }}{{ error.status === 'graduated' ? ' · 已克服' : '' }}</span></div></div>
    <div v-if="report.explained" class="mastery-objective-row-detail"><span>概念解释</span><div>{{ report.explained.summary }}</div></div>
    <div v-if="report.required_visual_tasks?.length" class="mastery-objective-row-detail"><span>独立视觉证据</span><div>{{ report.demonstrated_visual_tasks?.length || 0 }} / {{ report.required_visual_tasks.length }}</div></div>
    <p v-if="report.required_visual_tasks?.some(task => !report.demonstrated_visual_tasks?.includes(task))" class="mastery-objective-footnote">这个知识点仍需要独立的视觉证据。</p>
    <p v-if="attempts.some(attempt => attempt.independent === false)" class="mastery-objective-footnote">辅助练习与独立掌握分开记录。</p>

    <section v-if="evidence.length" class="mastery-objective-evidence"><h5>保持证据（{{ report.evidence_count ?? evidence.length }}）</h5><ul><li v-for="(item, index) in evidence" :key="`${item.timestamp}-${item.turn_id || index}`"><span>{{ resultLabel(item.result) }} · {{ assessmentLabel(item.assessment_type) }}{{ item.visual_context?.task ? ' · 视觉练习' : '' }}{{ item.hints_used ? ' · 有辅助' : '' }}{{ item.quality !== null ? ` · ${Math.round(item.quality * 100)}%` : '' }}</span><time>{{ relative(item.timestamp) }}</time></li></ul><p v-if="(report.evidence_count ?? evidence.length) > evidence.length">仅显示最近 20 条记录</p></section>
    <p v-if="!attempts.length && !report.explanation" class="mastery-objective-footnote">还没有作答记录。完成这个知识点的学习后，题目、你的回答和评分证据会显示在这里。</p>
  </div>
</template>
