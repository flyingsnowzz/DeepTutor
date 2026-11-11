<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, post } from '../api'

interface Action { id: string; label?: string; name?: string; description?: string }
interface Extension { id: string; actions: Action[] }
const props = defineProps<{ materialId: string; selection: string; locator: number; sessionId?: string }>()
const extensions = ref<Extension[]>([])
const busy = ref('')
const error = ref('')
const result = ref<any>(null)
const answers = ref<Record<string, number>>({})
const verdicts = ref<Record<string, boolean | null>>({})
const questions = computed(() => result.value?.questions || result.value?.quiz?.questions || [])
const terms = computed(() => result.value?.terms || result.value?.vocabulary || [])
onMounted(async () => { try { extensions.value = await api<Extension[]>('/api/reading/extensions') } catch (cause) { error.value = cause instanceof Error ? cause.message : '阅读扩展加载失败' } })
watch(() => [props.materialId, props.selection, props.locator], () => { result.value = null; answers.value = {}; verdicts.value = {} })
async function run(extension: Extension, action: Action) {
  busy.value = `${extension.id}:${action.id}`
  error.value = ''
  try { result.value = await post(`/api/reading/materials/${encodeURIComponent(props.materialId)}/extensions/${encodeURIComponent(extension.id)}/actions/${encodeURIComponent(action.id)}`, { locator: props.locator, selection: props.selection, locale: navigator.language || 'zh-CN' }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '扩展执行失败' }
  finally { busy.value = '' }
}
async function submitAnswers() {
  if (!questions.value.length) return
  busy.value = 'answers'
  try {
    const response = await post<{ answers: { question_id?: string; id?: string; correct?: boolean; is_correct?: boolean }[] }>(`/api/reading/materials/${encodeURIComponent(props.materialId)}/extensions/quiz/answers`, {
      locator: props.locator, session_id: props.sessionId || '', submission_id: crypto.randomUUID(),
      answers: questions.value.map((question: any, index: number) => ({ question_id: question.id || question.question_id || `${index}`, selected_index: answers.value[question.id || question.question_id || `${index}`] })),
    })
    for (const [index, verdict] of (response.answers || []).entries()) verdicts.value[questions.value[index]?.id || questions.value[index]?.question_id || `${index}`] = verdict.correct ?? verdict.is_correct ?? null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '提交答案失败' }
  finally { busy.value = '' }
}
</script>

<template>
  <section class="reading-extensions" aria-label="选区扩展">
    <div class="reading-extension-actions"><template v-for="extension in extensions" :key="extension.id"><button v-for="action in extension.actions" :key="`${extension.id}:${action.id}`" :disabled="Boolean(busy)" @click="run(extension, action)">{{ action.label || action.name || action.id }}</button></template></div><p v-if="busy" role="status">正在处理…</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="result" class="reading-extension-result"><p v-if="result.translation"><strong>翻译</strong>{{ result.translation }}</p><p v-for="alternative in result.alternatives || []" :key="alternative">{{ alternative }}</p><dl v-if="terms.length"><template v-for="term in terms" :key="term.term || term.word"><dt>{{ term.term || term.word }}</dt><dd>{{ term.meaning || term.definition }}<small v-if="term.usage"> · {{ term.usage }}</small></dd></template></dl><fieldset v-for="(question, index) in questions" :key="question.id || question.question_id || index"><legend>{{ question.prompt || question.question }}</legend><label v-for="(choice, choiceIndex) in question.choices || question.options || []" :key="choiceIndex"><input v-model.number="answers[question.id || question.question_id || `${index}`]" type="radio" :name="`${question.id || question.question_id || index}`" :value="choiceIndex">{{ choice }}</label><p v-if="verdicts[question.id || question.question_id || `${index}`] !== undefined">{{ verdicts[question.id || question.question_id || `${index}`] ? '回答正确' : '还需再练习' }}</p></fieldset><button v-if="questions.length" :disabled="busy === 'answers'" @click="submitAnswers">提交小测答案</button><pre v-if="!result.translation && !terms.length && !questions.length">{{ JSON.stringify(result, null, 2) }}</pre></div>
  </section>
</template>
