<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, onWatcherCleanup, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { scopedUrl } from '../workspaceScope'
import { buildResumeTurn, decideIdleTurnRecovery, readStoredChatResponseTimeout, reconnectDelay, shouldReconnect } from '../chatTransport'
import { consumeMasteryOpeningPrompt } from '../pendingPrompt'
import MarkdownView from '../components/MarkdownView.vue'
import QuizViewer from '../components/QuizViewer.vue'
import Geogebra from '../components/Geogebra.vue'
import VideoLessonViewer from '../components/VideoLessonViewer.vue'
import MathAnimatorViewer from '../components/MathAnimatorViewer.vue'
import VisualizationViewer from '../components/VisualizationViewer.vue'
import ResearchConfigPanel from '../components/ResearchConfigPanel.vue'
import ResearchOutlineEditor from '../components/ResearchOutlineEditor.vue'
import VisualizeConfigPanel from '../components/VisualizeConfigPanel.vue'
import CapabilityConfigCard from '../components/CapabilityConfigCard.vue'
import AskUserCard from '../components/AskUserCard.vue'
import SetupCredentialCard from '../components/SetupCredentialCard.vue'
import PartnerDraftCard from '../components/PartnerDraftCard.vue'
import MasteryHandoffCard from '../components/MasteryHandoffCard.vue'
import MasterySourcePresentation from '../components/MasterySourcePresentation.vue'
import { collectAppliedSettingIds, extractSetupCredential } from '../setupSignals'
import { refreshSetupUi } from '../setupSync'
import { extractPartnerDraft } from '../partnerDraft'
import { extractMasteryHandoffs } from '../masteryHandoff'
import { isQuoteAttachment, quoteAttachment, quoteText } from '../quoteAttachments'
import type { SideChatResponder } from '../sideChat'
import { groupSubagentEvents } from '../subagentTrace'
import { extractGeogebraRender, extractVisualizeResult, type VisualizeResult } from '../visualizeResult'
import { videoLessonFromMessage, type VideoLessonResult } from '../videoLesson'
import { extractMathAnimatorResult, type MathAnimatorResult } from '../mathAnimator'
import {
  buildResearchWSConfig,
  createEmptyResearchConfig,
  normalizeResearchConfig,
  validateResearchConfig,
  type DeepResearchFormConfig,
  type OutlineItem,
} from '../research'
import {
  buildVisualizeWSConfig,
  DEFAULT_VISUALIZE_CONFIG,
  type VisualizeFormConfig,
} from '../visualizeConfig'
import {
  buildDeepResearchPresentation,
  extractResearchOutlinePreview,
  shouldReturnToChatAfterResearch,
  type DeepResearchStatus,
} from '../deepResearchReport'
import { extractAskUserPayload } from '../askUser'
import { quizQuestionsForMessage, streamingQuizQuestions } from '../quiz/messageQuiz'
import { extractQuizTurnId, type QuizQuestion } from '../quiz/quizModel'
import type { SubmittedQuizResult } from '../quiz/quizSession'
import { canRecordQuizResults, quizResultsPayload, quizResultsSignature } from '../quiz/quizResults'
import LegacyIcon from '../components/LegacyIcon.vue'
import AgentGlyph from '../components/AgentGlyph.vue'
import ModelSelector from '../components/ModelSelector.vue'
import ResourceReuseToggle from '../components/ResourceReuseToggle.vue'
import AnswerPreferencesMenu from '../components/AnswerPreferencesMenu.vue'
import PartnerAvatar from '../components/PartnerAvatar.vue'
import ComposerSkillsMenu from '../components/ComposerSkillsMenu.vue'
import ComposerConnectorsMenu from '../components/ComposerConnectorsMenu.vue'
import ComposerGlyph from '../components/ComposerGlyph.vue'
import ComposerPartnerMenu from '../components/ComposerPartnerMenu.vue'
import StarterSuggestions from '../components/StarterSuggestions.vue'
import ChatCustomizeDialog from '../components/ChatCustomizeDialog.vue'
import ConversationSaveDialog from '../components/ConversationSaveDialog.vue'
import SessionViewerPanel from '../components/SessionViewerPanel.vue'
import SelectionActions from '../components/SelectionActions.vue'
import ContextReferenceTree, { type ContextTreeItem } from '../components/ContextReferenceTree.vue'
import ComposerResourcesPanel from '../components/ComposerResourcesPanel.vue'
import MasteryStudyOutline, { type MasteryStudyTopic } from '../components/MasteryStudyOutline.vue'
import MasteryQuestionCard from '../components/MasteryQuestionCard.vue'
import MasteryLevelUpCelebration from '../components/MasteryLevelUpCelebration.vue'
import { collectMasteryGrades, collectMasteryQuestions, collectMasterySkips } from '../masteryQuestions'
import ChatMessageActions from '../components/ChatMessageActions.vue'
import TurnActivityStream from '../components/TurnActivityStream.vue'
import AttachmentProcessingStream from '../components/AttachmentProcessingStream.vue'
import TraceViewer from '../components/TraceViewer.vue'
import ChatUserMessageEditor from '../components/ChatUserMessageEditor.vue'
import ChatUsageFooter from '../components/ChatUsageFooter.vue'
import ContextBudgetChip from '../components/ContextBudgetChip.vue'
import HistorySessionPicker from '../components/HistorySessionPicker.vue'
import MemoryPicker from '../components/MemoryPicker.vue'
import BookReferencePicker from '../components/BookReferencePicker.vue'
import ReadingReferencePicker from '../components/ReadingReferencePicker.vue'
import QuestionBankPicker from '../components/QuestionBankPicker.vue'
import NotebookRecordPicker from '../components/NotebookRecordPicker.vue'
import PersonaPicker from '../components/PersonaPicker.vue'
import MyAgentsPicker from '../components/MyAgentsPicker.vue'
import { selectedRecordsToPayload, type SelectedNotebookRecord } from '../notebookReferences'
import { selectedBooksToPayload, type SelectedBookReference } from '../bookReferences'
import { countSelectedReadingUnits, selectedReadingsToPayload, type SelectedReadingReference } from '../readingReferences'
import { trailingMention, type ComposerMentionItem } from '../composerMentions'
import { isResponseLanguage, matchingSlashCommands, RESPONSE_LANGUAGE_OPTIONS, type SlashCommand } from '../composerSlashCommands'
import { latestContextBudget } from '../contextBudget'
import { cumulativeMessageUsage, messageUsage } from '../usageSummary'
import ChatTurnNavigator from '../components/ChatTurnNavigator.vue'
import { buildVisiblePath, tipMessageId, type SiblingInfo } from '../messageBranches'
import { buildChatOutline, turnAnchorKey } from '../chatOutline'
import { loadVoicePreferences } from '../voicePreferences'
import { ATTACHMENT_ACCEPT, classifyFile, isSvgFilename } from '../attachmentTypes'
import { DEFAULT_ATTACHMENT_LIMITS, loadAttachmentLimits } from '../attachmentLimits'
import { sessionNavigationPath } from '../sessionNavigation'
import {
  normalizeResourceReuse,
  retainedKnowledgeBases,
  type ResourceReusePolicy,
} from '../resourceReuse'

type ChatAttachment = { id?: string; type: string; filename?: string; base64?: string; mime_type?: string; url?: string; size_bytes?: number; extracted_text?: string; text?: string; previewUrl?: string }
type Message = { id?: number; role: string; content: string; attachments?: ChatAttachment[]; events?: TurnEvent[]; metadata?: Record<string, unknown>; parentMessageId?: number | null; parent_message_id?: number | null; capability?: string }
type TurnEvent = { type: string; content?: string; session_id?: string; turn_id?: string; tool_call_id?: string; seq?: number; message?: string; status?: string; accepted?: boolean; metadata?: Record<string, unknown>; stage?: string; source?: string }
type Session = { id: string; title: string; messages?: Message[]; active_turn_id?: string; status?: string; content_workspace_id?: string; preferences?: Record<string, unknown> }
type Capability = { id: string; available?: boolean; manifest?: { display_name?: string; title?: string; description?: string } | null }
type LLMOption = { profile_id: string; model_id: string; profile_name: string; model_name: string; provider?: string; provider_label?: string; model?: string; context_window?: number; is_active_default?: boolean }
type ResourceOption = { id: string; name: string; description?: string; metadata?: { type?: string; agent_kind?: string } }
type ConnectedAgent = { name: string; kind?: string }
type MasterySubmissionAction = { masteryAnswer?: { question_id: string; text: string; answers?: Record<string, string> }; masterySkip?: { question_id: string } }
type FailedSubmission = { content: string; submissionId: string; attachments: ChatAttachment[]; masteryAction?: MasterySubmissionAction | null }
type NoteGeneration = { block_id: string; kind: string; label?: string; config?: Record<string, unknown> }
type PartnerOption = { partner_id: string; name: string; description?: string; emoji?: string; color?: string; avatar?: string }
type PartnerGroupOption = { group_id: string; name: string; emoji?: string; members?: Array<{ name: string }> }
type ChatCustomization = { hidden_modes: string[]; controls: { skills: boolean; mcp: boolean; partners: boolean; preferences: boolean; voice: boolean }; starters: Record<string, Array<{ label: string; prompt: string }> | undefined> }
type PageCustomization = { chat: ChatCustomization; learning: { hidden_features: string[] } }
type WorkspaceOption = { workspace_id: string; kind: string; display_name: string; archived: boolean; status?: string }
type TaskLink = { workspace_id: string; session_id: string; task_ids: string[]; status_link_enabled: boolean }
type TaskCard = { id: string; title: string; note?: string; status: string; archived?: boolean }
type TaskBoard = { cards?: TaskCard[]; colors?: Record<string, string>; session_links?: TaskLink[]; revision?: number }
type SelectedPassage = {
  text: string
  messageId: number | null
  anchor: { left: number; right: number; top: number; bottom: number }
}

const props = withDefaults(defineProps<{ mastery?: boolean; reading?: boolean; materialId?: string; noteDocumentId?: string; noteBlockId?: string; noteQuote?: string; readingSelection?: string; readingLocator?: number; readingRevision?: number; initialPrompt?: string; noteGeneration?: NoteGeneration | null; linkedSessionIds?: string[]; beforeSubmit?: () => Promise<boolean> }>(), { mastery: false, reading: false, materialId: '', noteDocumentId: '', noteBlockId: '', noteQuote: '', noteGeneration: null, linkedSessionIds: () => [] })
const emit = defineEmits<{ turnComplete: []; toggleMake: [] }>()
const route = useRoute()
const router = useRouter()
const routeSessionId = computed(() => {
  if (props.noteDocumentId) return String(route.query.chat || '')
  if (typeof route.params.sessionId !== 'string') return ''
  if (props.mastery && ['outline', 'review'].includes(route.params.sessionId)) return ''
  return route.params.sessionId
})
const masteryPathId = computed(() => props.mastery ? String(route.params.pathId || '') : '')
const readingWorkspaceId = computed(() => props.reading ? String(route.params.workspaceId || '') : '')
const chatBase = computed(() => props.noteDocumentId ? `/co-writer/${encodeURIComponent(props.noteDocumentId)}` : props.mastery ? `/learning/mastery/${encodeURIComponent(masteryPathId.value)}/sessions` : props.reading ? `/learning/reading/${encodeURIComponent(readingWorkspaceId.value)}/sessions` : '/chat')
const mode = ref<'outline' | 'study' | 'review'>('study')
const masteryTopic = ref<MasteryStudyTopic | null>(null)
const masteryAction = ref<MasterySubmissionAction | null>(null)
const answeredMasteryQuestions = ref<Set<string>>(new Set())
const skippedMasteryQuestions = ref<Set<string>>(new Set())
const masteryTopicError = ref('')
const masteryTopicLoading = ref(props.mastery)
const sessionLoading = ref(false)
const sessionError = ref('')
const sessionLoadedId = ref('')
const modeBusy = ref(false)
const askHint = ref('')
const outlineOpen = ref(localStorage.getItem('dt.mastery.outline') !== '0')
const justMasteredId = ref<string | null>(null)
const masteryCelebration = ref(false)
const masteryCelebrationKey = ref(0)
const openingAttempted = ref('')
const returnedResearchTurnKey = ref('')
let askHintRequest = 0
let masteredTimer: ReturnType<typeof setTimeout> | undefined
const masteryDisplayName = computed(() => masteryTopic.value?.name || masteryTopic.value?.metadata?.goal || '精通之路')

function geogebraFor(message: Message) {
  return extractGeogebraRender(message.metadata as unknown as Parameters<typeof extractGeogebraRender>[0])
}
function researchOutlineFor(message: Message) {
  return extractResearchOutlinePreview(message)
}
function askUserFor(message: Message, streaming = false) {
  return extractAskUserPayload(message.events, { streaming })
}
function liveAskUserFor() {
  return extractAskUserPayload(streamEvents.value, { streaming: busy.value })
}
function setupCredentialFor(message: Message) {
  return message.role === 'assistant' ? extractSetupCredential(message.events) : null
}
const liveSetupCredential = computed(() => extractSetupCredential(streamEvents.value))
function partnerDraftFor(message: Message) {
  return message.role === 'assistant' ? extractPartnerDraft(message.events) : null
}
function masteryHandoffsFor(message: Message) {
  return message.role === 'assistant' ? extractMasteryHandoffs(message.events) : []
}
const livePartnerDraft = computed(() => extractPartnerDraft(streamEvents.value))
const liveMasteryHandoffs = computed(() => extractMasteryHandoffs(streamEvents.value))
function videoLessonFor(message: Message): VideoLessonResult | null {
  return videoLessonFromMessage(message.events, message.capability)
}
function mathAnimatorFor(message: Message): MathAnimatorResult | null {
  if (message.capability !== 'math_animator') return null
  const result = [...(message.events ?? [])].reverse().find(event => event.type === 'result')
  return extractMathAnimatorResult(result?.metadata)
}
function visualizeFor(message: Message): VisualizeResult | null {
  if (message.capability !== 'visualize') return null
  const result = [...(message.events ?? [])].reverse().find(event => event.type === 'result')
  return extractVisualizeResult(result?.metadata)
}
function shouldShowResearchBody(message: Message, status: DeepResearchStatus | undefined) {
  if (!researchOutlineFor(message) || !status || status === 'editing') return false
  return Boolean(message.content)
}
function quizQuestionsFor(message: Message): QuizQuestion[] | null {
  return quizQuestionsForMessage(message)
}
function currentStreamingQuizQuestions(): QuizQuestion[] | null {
  return streamingQuizQuestions(streamEvents.value)
}
const submittedQuizQuestionIds = ref<Set<string>>(new Set())
const recordedQuizResultSignatures = ref<Set<string>>(new Set())
async function onQuizSubmit(results: SubmittedQuizResult[], message?: Message) {
  for (const result of results) submittedQuizQuestionIds.value.add(result.question_id)
  const sessionId = routeSessionId.value
  const turnId = message ? extractQuizTurnId(message.events) : null
  if (!canRecordQuizResults(sessionId, turnId, results) || !sessionId || !turnId) return
  const signature = quizResultsSignature(sessionId, turnId, results)
  if (recordedQuizResultSignatures.value.has(signature)) return
  recordedQuizResultSignatures.value.add(signature)
  try {
    await api(`/api/sessions/${encodeURIComponent(sessionId)}/quiz-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quizResultsPayload(results, turnId)),
    })
  } catch (cause) {
    recordedQuizResultSignatures.value.delete(signature)
    error.value = cause instanceof Error ? cause.message : '随堂练习结果保存失败'
  }
}
const masteryWaypoint = computed(() => {
  const current = masteryTopic.value
  if (!current) return { id: '', name: masteryDisplayName.value }
  if (current.next?.knowledge_point_name) return { id: current.next.knowledge_point_id || '', name: current.next.knowledge_point_name }
  for (const module of current.map.modules) {
    const point = module.knowledge_points.find(item => item.status !== 'mastered')
    if (point) return { id: point.id, name: point.name }
  }
  return { id: '', name: current.map.complete ? '全部完成' : masteryDisplayName.value }
})
const masteryProgress = computed(() => {
  const counts = masteryTopic.value?.map.counts
  return counts?.total ? counts.mastered / counts.total : 0
})
const masteryModeNote = computed(() => ({
  outline: '此模式只用于商定学习路线，还不会开始讲授知识点。',
  study: '',
  review: '此模式会重新检测已经学过的内容，不会讲授新的知识点。',
}[mode.value]))
const masteryEmptyCopy = computed(() => ({
  outline: { eyebrow: '从这里开始', title: '设计你的学习大纲', body: '导师会阅读你选择的资料，了解你已有的基础，再提出一条可以调整的学习路线。' },
  study: { eyebrow: '接下来', title: masteryWaypoint.value.name, body: '导师会根据你的回答调整节奏。可以从快速检测、直观讲解或一道挑战题开始。' },
  review: { eyebrow: '从这里开始', title: '回顾你已经掌握的内容', body: '复习会优先安排已经到期的内容，你也可以重新检测任何已掌握的知识点。' },
}[mode.value]))
const masteryStarters = computed(() => ({
  outline: [
    { icon: 'learning', label: '根据我选择的资料起草学习大纲' },
    { icon: 'sparkles', label: '先问我几个问题，再提出学习大纲' },
    { icon: 'bookmark', label: '我想先讨论需要学到什么程度' },
  ],
  study: [
    { icon: 'learning', label: '先快速检测一下我已经掌握的内容' },
    { icon: 'sparkles', label: '从直觉和一个具体例子开始教我' },
    { icon: 'bookmark', label: '直接给我一道有挑战的问题' },
  ],
  review: [
    { icon: 'learning', label: '复习今天到期的内容' },
    { icon: 'sparkles', label: '回顾我觉得最难的内容' },
    { icon: 'bookmark', label: '检测所有我已经掌握的内容' },
  ],
}[mode.value]))
function toggleMasteryOutline() {
  outlineOpen.value = !outlineOpen.value
  try { localStorage.setItem('dt.mastery.outline', outlineOpen.value ? '1' : '0') } catch { /* The toggle still works when storage is blocked. */ }
}
async function loadMasteryTopic() {
  if (!props.mastery || !masteryPathId.value) return
  masteryTopicError.value = ''
  masteryTopicLoading.value = !masteryTopic.value
  try {
    const result = await api<MasteryStudyTopic>(`/api/mastery-paths/topics/${encodeURIComponent(masteryPathId.value)}`)
    masteryTopic.value = result
    const sources = (result as MasteryStudyTopic & { sources?: Array<{ kind: string; source_id: string }> }).sources || []
    if (!routeSessionId.value && !selectedKbs.value.size) selectedKbs.value = new Set(sources.filter(source => source.kind === 'knowledge_base').map(source => source.source_id))
    if (!routeSessionId.value && mode.value === 'outline' && prompt.value && !messages.value.length && !busy.value) {
      const key = `${masteryPathId.value}:${prompt.value}`
      if (openingAttempted.value !== key) {
        openingAttempted.value = key
        await nextTick()
        void submit()
      }
    }
  } catch (cause) {
    masteryTopic.value = null
    masteryTopicError.value = cause instanceof Error ? cause.message : '学习地图加载失败'
  } finally {
    masteryTopicLoading.value = false
  }
}
async function loadMasteryAskHint() {
  if (!props.mastery || busy.value || !masteryTopic.value) return
  const request = ++askHintRequest
  try {
    const query = routeSessionId.value ? `?session_id=${encodeURIComponent(routeSessionId.value)}` : ''
    const result = await api<{ hint?: string }>(`/api/mastery-paths/topics/${encodeURIComponent(masteryPathId.value)}/ask-hint${query}`)
    if (request === askHintRequest) askHint.value = typeof result.hint === 'string' ? result.hint : ''
  } catch { /* The waypoint placeholder remains available when hint generation fails. */ }
}
function startMasteryPrompt(value: string) {
  if (busy.value || modeBusy.value) return
  masteryAction.value = null
  prompt.value = value
  void nextTick(() => submit())
}
watch(masteryTopic, (next, previous) => {
  if (!next || !previous) return
  const before = new Map(previous.map.modules.flatMap(module => module.knowledge_points.map(point => [point.id, point.status])))
  for (const module of next.map.modules) {
    const point = module.knowledge_points.find(item => before.get(item.id) && before.get(item.id) !== 'mastered' && item.status === 'mastered')
    if (point) {
      justMasteredId.value = point.id
      masteryCelebrationKey.value += 1
      masteryCelebration.value = true
      if (masteredTimer) clearTimeout(masteredTimer)
      masteredTimer = setTimeout(() => { justMasteredId.value = null }, 1700)
      return
    }
  }
})
const isNewConversation = computed(() => !props.mastery && !props.reading && !props.noteDocumentId && !routeSessionId.value && messages.value.length === 0 && !streaming.value)
const isStandardConversation = computed(() => !props.mastery && !props.reading && !props.noteDocumentId && !isNewConversation.value)
const displaySessionTitle = computed(() => {
  const sessionTitle = sessions.value.find(session => session.id === routeSessionId.value)?.title
  if (sessionTitle && !['新对话', 'New conversation', 'Untitled'].includes(sessionTitle)) return sessionTitle
  return messages.value.find(message => message.role === 'user')?.content?.trim() || sessionTitle || '新对话'
})
const composerTextarea = ref<HTMLTextAreaElement | null>(null)
const standardComposerHeight = ref(101)
const newComposerHeight = ref(137)
const composerStyle = computed(() => isStandardConversation.value
  ? { height: `${standardComposerHeight.value}px` }
  : isNewConversation.value ? { height: `${newComposerHeight.value}px` } : {})
function resizeComposerTextarea() {
  const el = composerTextarea.value
  if (!el) return
  if (!isNewConversation.value && !isStandardConversation.value) return
  const minimum = isNewConversation.value ? 64 : 28
  el.style.height = 'auto'
  const textHeight = Math.max(minimum, Math.min(200, el.scrollHeight))
  el.style.height = `${textHeight}px`
  if (isNewConversation.value) newComposerHeight.value = Math.max(137, textHeight + 73)
  else standardComposerHeight.value = Math.max(101, textHeight + 73)
}
const welcomeGreeting = ref('今天想学什么？')
const customizeDialog = ref(false)
const customization = ref<PageCustomization>({ chat: { hidden_modes: [], controls: { skills: true, mcp: true, partners: true, preferences: true, voice: true }, starters: {} }, learning: { hidden_features: [] } })
const resourcesOpen = ref(false)
const resourceTrigger = ref<HTMLButtonElement | null>(null)
const resourceAnchor = ref({ left: 12, bottom: 12 })
function toggleResources() {
  if (!resourcesOpen.value) {
    const rect = resourceTrigger.value?.getBoundingClientRect()
    if (rect) resourceAnchor.value = {
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 348)),
      bottom: window.innerHeight - rect.top + 8,
    }
  }
  resourcesOpen.value = !resourcesOpen.value
  preferencesOpen.value = false
  partnerOpen.value = false
}
function closeResources() {
  resourcesOpen.value = false
  void nextTick(() => resourceTrigger.value?.focus())
}
const preferencesOpen = ref(false)
const partnerOpen = ref(false)
const sessionSwitcherOpen = ref(false)
const partnerOptions = ref<PartnerOption[]>([])
const partnerGroups = ref<PartnerGroupOption[]>([])
const selectedPartner = ref('')
const selectedPartnerGroup = ref('')
const recording = ref(false)
let mediaRecorder: MediaRecorder | null = null
let mediaStream: MediaStream | null = null
const selectedCapability = ref('chat')
const capabilityMenuOpen = ref(false)
const moreCapabilitiesOpen = ref(false)

const TRAY_FOLD_KEY = 'deeptutor.composer-tray'
const TRAY_FOLD_EVENT = 'deeptutor:composer-tray'
const readTrayFolded = () => {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(TRAY_FOLD_KEY) === 'folded' } catch { return false }
}
const trayFolded = ref(readTrayFolded())
const trayReveal = ref(trayFolded.value ? 0 : 1)
const trayDragging = ref(false)
const trayStyle = computed<Record<string, string>>(() => ({ '--dt-tray-reveal': String(trayReveal.value) }))
let trayDrag: { startY: number; from: number; travel: number; moved: boolean; pointerId: number } | null = null
let trayRelease: (() => void) | null = null
let traySwallowClick = false
function writeTrayFolded(folded: boolean) {
  try { window.localStorage.setItem(TRAY_FOLD_KEY, folded ? 'folded' : 'open') } catch { /* storage is optional */ }
  window.dispatchEvent(new Event(TRAY_FOLD_EVENT))
}
function settleTray(open: boolean) {
  trayFolded.value = !open
  trayDragging.value = false
  trayReveal.value = open ? 1 : 0
  writeTrayFolded(!open)
}
function trayTravel(sheet: HTMLElement) {
  return Number.parseFloat(getComputedStyle(sheet).getPropertyValue('--dt-tray-travel')) || 23
}
function onTrayPointerDown(event: PointerEvent) {
  traySwallowClick = false
  if (event.button !== 0) return
  const target = event.target as Element
  if (!trayFolded.value && target.closest('.composer-tray-control, .capability-picker')) return
  trayRelease?.()
  const sheet = event.currentTarget as HTMLElement
  const current = { startY: event.clientY, from: trayReveal.value, travel: trayTravel(sheet), moved: false, pointerId: event.pointerId }
  trayDrag = current
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== current.pointerId) return
    if (!current.moved) {
      const dy = move.clientY - current.startY
      if (Math.abs(dy) < 4) return
      current.moved = true
      current.startY += Math.sign(dy) * 4
      try { sheet.setPointerCapture(current.pointerId) } catch { /* window still receives the release */ }
      trayDragging.value = true
    }
    move.preventDefault()
    const px = current.from * current.travel + (move.clientY - current.startY)
    trayReveal.value = Math.max(0, Math.min(1, px / current.travel))
  }
  const onEnd = (end: PointerEvent) => {
    if (end.pointerId !== current.pointerId) return
    trayRelease?.()
    if (!current.moved) return
    traySwallowClick = true
    settleTray(trayReveal.value >= 0.5)
  }
  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onEnd)
  trayRelease = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
    trayRelease = null
    if (trayDrag === current) trayDrag = null
  }
}
function onTrayClick(event: MouseEvent) {
  const target = event.target as Element
  if (traySwallowClick) { traySwallowClick = false; return }
  if (target.closest('.dt-tray-grip') || (trayFolded.value && !target.closest('.composer-tray-control'))) settleTray(trayFolded.value)
}
function onTrayGripKeyDown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const open = event.key === 'ArrowDown'
  if (open === !trayFolded.value) return
  event.preventDefault()
  settleTray(open)
}
function syncTrayFold(event: StorageEvent) { if (!event.key || event.key === TRAY_FOLD_KEY) { trayFolded.value = readTrayFolded(); trayReveal.value = trayFolded.value ? 0 : 1 } }
function syncTrayFoldEvent() { trayFolded.value = readTrayFolded(); trayReveal.value = trayFolded.value ? 0 : 1 }
const capabilities = ref<Capability[]>([{ id: 'chat', available: true }])
const researchConfig = ref<DeepResearchFormConfig>(createEmptyResearchConfig())
const researchConfigConfirmed = ref(false)
const visualizeConfig = ref<VisualizeFormConfig>({ ...DEFAULT_VISUALIZE_CONFIG })
const visualizeConfigConfirmed = ref(false)
const researchValidation = computed(() => validateResearchConfig(researchConfig.value))
const researchValidationMessages = computed(() => Object.values(researchValidation.value.errors))

const capabilityPresentation: Record<string, { label: string; description: string; icon: string; secondary?: boolean; legacy?: boolean }> = {
  chat: { label: '聊天', description: '灵活对话，可使用任意工具', icon: 'chat' },
  deep_solve: { label: '解题', description: '多步推理与问题求解', icon: 'memory', secondary: true },
  ask_questions: { label: '主动提问', description: '让模型向你提问，补充它尚不了解的上下文', icon: 'questions' },
  deep_question: { label: '测验', description: '自动校验的题目生成', icon: 'edit' },
  deep_research: { label: '研究', description: '多智能体综合研究', icon: 'search', secondary: true },
  visualize: { label: '可视化', description: '生成图表、示意图、交互页面或数学动画', icon: 'resources' },
  video_lesson: { label: '视频讲解', description: '把问题做成可以播放的讲解动画', icon: 'terminal' },
  math_animator: { label: '数学动画', description: 'Generate math animations or storyboard images with Manim.', icon: 'terminal', secondary: true },
  audio_overview: { label: 'Audio Overview', description: 'Create a grounded two-voice audio overview and transcript from a knowledge base.', icon: 'chat', secondary: true },
  mastery_path: { label: '掌握路径', description: '掌握度驱动的引导学习', icon: 'learning', legacy: true },
  immersive_reading: { label: '沉浸阅读', description: '围绕阅读材料对话', icon: 'journal', legacy: true },
}
const capabilityOrder = ['deep_solve', 'ask_questions', 'deep_question', 'deep_research', 'visualize', 'video_lesson', 'audio_overview', 'math_animator']
const allPresentedCapabilities = computed(() => capabilities.value.map((capability, sourceIndex) => {
  const fallback = { label: capability.id.split(/[_-]+/).filter(Boolean).map(part => part[0]?.toUpperCase() + part.slice(1)).join(' '), description: capability.manifest?.description || '扩展能力', icon: 'resources', secondary: true }
  return { id: capability.id, ...(capabilityPresentation[capability.id] || fallback), sourceIndex }
}).filter(capability => !capability.legacy && capability.id !== 'chat').sort((a, b) => {
  const ai = capabilityOrder.indexOf(a.id); const bi = capabilityOrder.indexOf(b.id)
  if (ai < 0 && bi < 0) return a.sourceIndex - b.sourceIndex
  if (ai < 0) return 1; if (bi < 0) return -1; return ai - bi
}))
const presentedCapabilities = computed(() => allPresentedCapabilities.value.filter(capability => !customization.value.chat.hidden_modes.includes(capability.id)))
const primaryCapabilities = computed(() => presentedCapabilities.value.filter(capability => !capability.secondary))
const secondaryCapabilities = computed(() => presentedCapabilities.value.filter(capability => capability.secondary))
const activeCapability = computed(() => presentedCapabilities.value.find(capability => capability.id === selectedCapability.value) || presentedCapabilities.value[0] || { id: 'chat', ...capabilityPresentation.chat })
function capabilityGlyph(id: string) {
  const names: Record<string, string> = {
    deep_solve: 'mode-deep-solve',
    ask_questions: 'mode-ask-questions',
    deep_question: 'mode-deep-question',
    deep_research: 'mode-deep-research',
    visualize: 'mode-visualize',
    video_lesson: 'mode-video-lesson',
    audio_overview: 'mode-audio-overview',
    math_animator: 'mode-math-animator',
  }
  return (names[id] || 'mode-math-animator') as 'mode-deep-solve' | 'mode-ask-questions' | 'mode-deep-question' | 'mode-deep-research' | 'mode-visualize' | 'mode-video-lesson' | 'mode-audio-overview' | 'mode-math-animator'
}
const activeModeGlyph = computed(() => ({
  math_animator: 'mode-math-animator',
  visualize: 'mode-visualize',
  ask_questions: 'mode-ask-questions',
  deep_question: 'mode-deep-question',
  deep_solve: 'mode-deep-solve',
  deep_research: 'mode-deep-research',
  audio_overview: 'mode-audio-overview',
} as const)[selectedCapability.value as 'math_animator' | 'visualize' | 'ask_questions' | 'deep_question' | 'deep_solve' | 'deep_research' | 'audio_overview'] || 'mode-math-animator')
const modeLeadElement = ref<HTMLElement | null>(null)
const leadTextIndent = ref(0)
const composerTextStyle = computed(() => leadTextIndent.value ? { textIndent: `${leadTextIndent.value}px` } : {})
watch(selectedCapability, async () => {
  researchConfigConfirmed.value = false
  visualizeConfigConfirmed.value = false
  await nextTick()
  if (selectedCapability.value === 'chat') leadTextIndent.value = 0
  else leadTextIndent.value = modeLeadElement.value?.offsetWidth || 0
}, { immediate: true })
function chooseCapability(id: string) { selectedCapability.value = selectedCapability.value === id || id === 'chat' ? 'chat' : id; capabilityMenuOpen.value = false; moreCapabilitiesOpen.value = false }
function updateResearchConfig(value: DeepResearchFormConfig) {
  researchConfig.value = value
  researchConfigConfirmed.value = false
}
function updateVisualizeConfig(value: VisualizeFormConfig) {
  visualizeConfig.value = value
  visualizeConfigConfirmed.value = false
}
function pickStarter(value: string) { prompt.value = value; void nextTick(() => document.querySelector<HTMLTextAreaElement>('.composer > textarea')?.focus()) }
function closeCapabilityMenu(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.capability-picker')) { capabilityMenuOpen.value = false; moreCapabilitiesOpen.value = false }
  if (!target.closest('.conversation-actions')) { sessionMenuOpen.value = false; customizeOpen.value = false }
  if (!target.closest('.chat-mode-resources') && !target.closest('.composer-resources-panel')) resourcesOpen.value = false
  if (!target.closest('.chat-mode-preferences')) preferencesOpen.value = false
  if (!target.closest('.chat-mode-partner')) partnerOpen.value = false
  if (!target.closest('.chat-session-switcher')) sessionSwitcherOpen.value = false
  if (!target.closest('.composer-slash-menu') && !target.closest('form.composer textarea')) slashDismissed.value = true
  if (!target.closest('.composer-language-picker')) languagePopupOpen.value = false
}
function openActivity(tab: 'activity' | 'attachments' | 'note') {
  if (tab === 'activity') {
    activityOpen.value = !activityOpen.value
    if (activityOpen.value) void ensureSessionResources()
    return
  }
  activityTab.value = tab
  activityOpen.value = true
  void nextTick(() => {
    if (tab === 'note') viewerPanel.value?.showNote()
    else viewerPanel.value?.showActivity()
  })
}
function openAttachmentViewer(attachment: ChatAttachment) {
  activityTab.value = 'attachments'
  activityOpen.value = true
  void nextTick(() => viewerPanel.value?.showAttachment(attachment))
}
function renameCurrentSession() {
  const current = sessions.value.find(item => item.id === routeSessionId.value)
  if (!current) return
  renameDraft.value = current.title || '新对话'
  renamingSession.value = true
  sessionMenuOpen.value = false
  sessionSwitcherOpen.value = false
  void nextTick(() => { renameInput.value?.focus(); renameInput.value?.select() })
}
async function commitRenameSession() {
  if (!renamingSession.value) return
  const current = sessions.value.find(item => item.id === routeSessionId.value)
  const title = renameDraft.value.trim()
  renamingSession.value = false
  if (!current || !title || title === current.title) return
  await api(`/api/sessions/${encodeURIComponent(current.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
  current.title = title
}
function cancelRenameSession() { renamingSession.value = false; renameDraft.value = '' }
function exportCurrentSession() { const current = sessions.value.find(item => item.id === routeSessionId.value); if (!current) return; const markdown = [`# ${current.title || '新对话'}`, '', ...messages.value.flatMap(message => [`## ${message.role === 'user' ? '你' : 'DeepTutor'}`, '', message.content, ''])].join('\n'); const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${current.title || '新对话'}.md`; anchor.click(); URL.revokeObjectURL(url); sessionMenuOpen.value = false }
async function toggleTaskStatusLink() {
  const link = currentTaskLink.value
  if (!link || !routeSessionId.value) return
  const result = await api<TaskBoard>(`/api/task-board/sessions/${encodeURIComponent(routeSessionId.value)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: currentWorkspaceId.value, enabled: !link.status_link_enabled }) })
  taskBoard.value = result
  sessionMenuOpen.value = false
}
async function ensureSessionResources() {
  if (sessionResourcesLoaded.value) return
  const [workspaceResult, boardResult] = await Promise.allSettled([
    api<{ workspaces: WorkspaceOption[] }>('/api/settings/workspace/registrations'),
    api<TaskBoard>('/api/task-board'),
  ])
  if (workspaceResult.status === 'fulfilled') workspaces.value = workspaceResult.value.workspaces || []
  if (boardResult.status === 'fulfilled') taskBoard.value = boardResult.value
  sessionResourcesLoaded.value = true
}
async function toggleSessionMenu() {
  sessionMenuOpen.value = !sessionMenuOpen.value
  customizeOpen.value = false
  if (!sessionMenuOpen.value) return
  await ensureSessionResources()
}
async function organizeCurrentSession(patch: Record<string, unknown>) {
  const current = currentSession.value
  if (!current) return
  movingWorkspace.value = 'workspace_id' in patch
  try {
    const result = await api<{ session?: Session }>(`/api/sessions/${encodeURIComponent(current.id)}/organization`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (result.session) Object.assign(current, result.session, { preferences: { ...current.preferences, ...result.session.preferences } })
    else current.preferences = { ...current.preferences, ...patch }
    sessionMenuOpen.value = false
    if ('workspace_id' in patch) {
      sessionResourcesLoaded.value = false
      await router.push(sessionNavigationPath(current))
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新会话失败' }
  finally { movingWorkspace.value = false }
}
function openSaveDialog() { saveDialogOpen.value = true; sessionMenuOpen.value = false }

async function deleteCurrentSession() { const current = sessions.value.find(item => item.id === routeSessionId.value); sessionMenuOpen.value = false; if (!current || !window.confirm(`删除“${current.title || '新对话'}”？`)) return; await api(`/api/sessions/${encodeURIComponent(current.id)}`, { method: 'DELETE' }); sessions.value = sessions.value.filter(item => item.id !== current.id); await router.push(chatBase.value) }

const pendingAttachments = ref<ChatAttachment[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const streamEvents = ref<TurnEvent[]>([])
const attachmentLimits = ref({ ...DEFAULT_ATTACHMENT_LIMITS })
const attachmentError = ref('')
const draggingFiles = ref(false)
let dragCounter = 0
let attachmentErrorTimer: ReturnType<typeof setTimeout> | undefined
const llmOptions = ref<LLMOption[]>([])
const selectedModel = ref('')
const answerBy = ref('')
const preferenceLabel = computed(() => {
  if (answerBy.value.startsWith('partner:')) return partnerOptions.value.find(item => item.partner_id === answerBy.value.slice(8))?.name || answerBy.value.slice(8)
  if (answerBy.value.startsWith('subagent:')) return answerBy.value.slice(9)
  return selectedPersona.value || '默认'
})
const answeredPartner = computed(() => answerBy.value.startsWith('partner:') ? partnerOptions.value.find(item => item.partner_id === answerBy.value.slice(8)) || null : null)
const answeredAgent = computed(() => answerBy.value.startsWith('subagent:') ? connectedAgents.value.find(item => item.name === answerBy.value.slice(9)) || null : null)
const personas = ref<ResourceOption[]>([])
const selectedPersona = ref('')
const personaPickerOpen = ref(false)
const knowledgeBases = ref<ResourceOption[]>([])
const selectedKbs = ref<Set<string>>(new Set())
const skillOptions = ref<ResourceOption[]>([])
const selectedSkills = ref<Set<string>>(new Set())
const mcpOptions = ref<ResourceOption[]>([])
const selectedMcp = ref<Set<string>>(new Set())
const notebookOptions = ref<ResourceOption[]>([])
const notebookPickerOpen = ref(false)
const selectedNotebookRecords = ref<SelectedNotebookRecord[]>([])
const historyPickerOpen = ref(false)
const selectedHistorySessions = ref<Array<{ sessionId: string; title: string }>>([])
const agentsPickerOpen = ref(false)
const selectedAgentSessions = ref<Array<{ sessionId: string; title: string }>>([])
const resourceReuse = ref({ attachments: false, history: false, memory: false, questions: false, books: false, reading: false, notebooks: false, agents: false, persona: true, skills: true, mcp: true, partner: true, partner_group: true, agent: true })
const mentionIndex = ref(0)
const mentionDismissed = ref(false)
const slashIndex = ref(0)
const slashDismissed = ref(false)
const languagePopupOpen = ref(false)
const languageIndex = ref(0)
const languageSaving = ref(false)
const replyLanguageOverride = ref<string | null>(null)
const accountResponseLanguage = ref('en')
const mention = computed(() => !props.reading && !props.noteDocumentId ? trailingMention(prompt.value) : null)
const agentMentionMode = computed(() => !props.mastery && !props.reading && !props.noteDocumentId)
const connectedAgents = computed<ConnectedAgent[]>(() => knowledgeBases.value.filter(kb => kb.metadata?.type === 'subagent' && kb.metadata?.agent_kind !== 'partner').map(kb => ({ name: kb.name, kind: kb.metadata?.agent_kind })))
const mainResourceReuse = computed<ResourceReusePolicy>(() => normalizeResourceReuse({
  attachments: resourceReuse.value.attachments,
  books: resourceReuse.value.books,
  reading: resourceReuse.value.reading,
  notebooks: resourceReuse.value.notebooks,
  chat_history: resourceReuse.value.history,
  my_agents: resourceReuse.value.agents,
  question_bank: resourceReuse.value.questions,
  memory: resourceReuse.value.memory,
  knowledge: true,
  persona: resourceReuse.value.persona,
  agent: resourceReuse.value.agent,
  partner: resourceReuse.value.partner,
  partner_group: resourceReuse.value.partner_group,
  skills: resourceReuse.value.skills,
  mcp: resourceReuse.value.mcp,
}))
const selectedAgent = computed(() => connectedAgents.value.find(agent => selectedKbs.value.has(agent.name))?.name || '')
const subagentBudget = ref<number | null>(null)
const selectedConsultAgent = computed({ get: () => selectedAgent.value, set: selectConsultAgent })
const consultPartnerChoice = computed({ get: () => selectedPartner.value, set: (value: string) => { selectedPartner.value = value; answerBy.value = '' } })
const consultGroupChoice = computed({ get: () => selectedPartnerGroup.value, set: (value: string) => { selectedPartnerGroup.value = value; answerBy.value = '' } })
const filteredAgents = computed(() => {
  const keyword = mention.value?.query.toLocaleLowerCase() || ''
  return connectedAgents.value.filter(agent => agent.name.toLocaleLowerCase().includes(keyword))
})
const mentionOpen = computed(() => Boolean(mention.value) && !mentionDismissed.value)
const slashCommands = computed<SlashCommand[]>(() => matchingSlashCommands(prompt.value, [
  'persona',
  ...(!busy.value && !languageSaving.value ? ['language' as const] : []),
]))
const languageChoices = computed(() => {
  const label = RESPONSE_LANGUAGE_OPTIONS.find(option => option.value === accountResponseLanguage.value)?.label || 'English'
  return [{ value: '', label: `账户默认 (${label})` }, ...RESPONSE_LANGUAGE_OPTIONS]
})
const languagePickerBelow = computed(() => messages.value.length === 0)
const mentionItems = computed<ComposerMentionItem[]>(() => {
  const items: ComposerMentionItem[] = [
    { key: 'attach', label: '添加附件', description: '上传图片、Office 文档、代码或文本。', icon: 'attachment', count: pendingAttachments.value.length },
    { key: 'history', label: '对话记录', description: '引用一条或多条历史对话。', icon: 'history', count: selectedHistorySessions.value.length },
    { key: 'agents', label: '我的智能体', description: '引用导入的 Claude Code / Codex 对话。', icon: 'agents', count: selectedAgentSessions.value.length },
    { key: 'books', label: '书籍章节', description: '引用生成书籍的具体页面。', icon: 'book', count: selectedBookReferences.value.reduce((total, book) => total + book.pages.length, 0) },
    { key: 'reading', label: '精读章节', description: '在对话中引用已导入的精读材料章节。', icon: 'reading', count: countSelectedReadingUnits(selectedReadingReferences.value) },
    { key: 'notebooks', label: '收藏夹记录', description: '引用收藏夹中的具体记录。', icon: 'bookmark', count: selectedNotebookRecords.value.length },
    { key: 'questions', label: '题库', description: '引用题目和作答记录。', icon: 'questions', count: selectedQuestionIds.value.length },
    { key: 'memory', label: '记忆', description: '附加摘要或学习者档案。', icon: 'memory', count: selectedMemoryFiles.value.length },
  ]
  const keyword = mention.value?.query.toLowerCase() || ''
  return keyword ? items.filter(item => `${item.label} ${item.description} ${item.key}`.toLowerCase().includes(keyword)) : items
})
function selectComposerMention(key: string) {
  const current = mention.value
  if (current) prompt.value = prompt.value.slice(0, current.start).trimEnd()
  mentionIndex.value = 0
  slashDismissed.value = true
  if (key === 'attach') fileInput.value?.click()
  else if (key === 'history') historyPickerOpen.value = true
  else if (key === 'agents') agentsPickerOpen.value = true
  else if (key === 'memory') memoryPickerOpen.value = true
  else if (key === 'questions') questionPickerOpen.value = true
  else if (key === 'books') bookPickerOpen.value = true
  else if (key === 'reading') readingPickerOpen.value = true
  else if (key === 'notebooks') notebookPickerOpen.value = true
  void nextTick(() => messageList.value?.querySelector<HTMLTextAreaElement>('form.composer textarea')?.focus())
}
function selectAgentMention(name: string) {
  const current = mention.value
  if (current) prompt.value = prompt.value.slice(0, current.start).trimEnd()
  const agentNames = new Set(connectedAgents.value.map(agent => agent.name))
  selectedKbs.value = new Set([...selectedKbs.value].filter(value => !agentNames.has(value)).concat(name))
  selectedPartner.value = ''
  answerBy.value = ''
  mentionDismissed.value = true
  focusComposerTextarea()
}
function selectConsultAgent(name: string) {
  const agentNames = new Set(connectedAgents.value.map(agent => agent.name))
  selectedKbs.value = new Set([...selectedKbs.value].filter(value => !agentNames.has(value)).concat(name ? [name] : []))
  if (name) {
    selectedPartner.value = ''
    selectedPartnerGroup.value = ''
  }
  answerBy.value = ''
}
function focusComposerTextarea() {
  void nextTick(() => messageList.value?.querySelector<HTMLTextAreaElement>('form.composer textarea')?.focus())
}
function selectComposerSlashCommand(command: SlashCommand) {
  // Command text is never part of the message sent to the model.
  prompt.value = ''
  slashIndex.value = 0
  slashDismissed.value = true
  if (command === 'persona') {
    preferencesOpen.value = true
    focusComposerTextarea()
    return
  }
  const selected = languageChoices.value.findIndex(choice => choice.value === (replyLanguageOverride.value || ''))
  languageIndex.value = Math.max(0, selected)
  languagePopupOpen.value = true
  focusComposerTextarea()
}
let pendingLanguageSave: { sessionId: string; promise: Promise<void> } | null = null
function selectReplyLanguage(value: string) {
  const language = value || null
  languagePopupOpen.value = false
  const current = currentSession.value
  if (!current) {
    replyLanguageOverride.value = language
    focusComposerTextarea()
    return
  }
  const sessionId = current.id
  languageSaving.value = true
  const operation = { sessionId, promise: Promise.resolve() }
  operation.promise = (async () => {
    try {
      const result = await api<{ session: Session }>(`/api/sessions/${encodeURIComponent(sessionId)}/reply-language`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language }),
      })
      const saved = result.session?.preferences?.reply_language_override
      replyLanguageOverride.value = isResponseLanguage(saved) ? saved : null
      if (current.preferences) current.preferences = { ...current.preferences, ...result.session.preferences }
      else current.preferences = { ...result.session.preferences }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存回复语言失败'
      throw cause
    } finally {
      languageSaving.value = false
      if (pendingLanguageSave === operation) pendingLanguageSave = null
      focusComposerTextarea()
    }
  })()
  pendingLanguageSave = operation
  void operation.promise.catch(() => undefined)
}
function handleComposerKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (languagePopupOpen.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      languageIndex.value = (languageIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + languageChoices.value.length) % languageChoices.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      selectReplyLanguage(languageChoices.value[languageIndex.value]?.value || '')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      languagePopupOpen.value = false
      focusComposerTextarea()
      return
    }
  }
  if (!slashDismissed.value && slashCommands.value.length) {
    if (slashIndex.value >= slashCommands.value.length) slashIndex.value = 0
    if (event.key === 'ArrowDown') { event.preventDefault(); slashIndex.value = (slashIndex.value + 1) % slashCommands.value.length; return }
    if (event.key === 'ArrowUp') { event.preventDefault(); slashIndex.value = (slashIndex.value - 1 + slashCommands.value.length) % slashCommands.value.length; return }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      event.preventDefault()
      const command = slashCommands.value[slashIndex.value]
      if (command) selectComposerSlashCommand(command)
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); slashDismissed.value = true; return }
  }
  if (mentionOpen.value && agentMentionMode.value) {
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && filteredAgents.value.length) {
      event.preventDefault()
      selectAgentMention(filteredAgents.value[0].name)
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); mentionDismissed.value = true; return }
  }
  if (mentionOpen.value && !agentMentionMode.value && mentionItems.value.length) {
    if (mentionIndex.value >= mentionItems.value.length) mentionIndex.value = 0
    if (event.key === 'ArrowDown') { event.preventDefault(); mentionIndex.value = (mentionIndex.value + 1) % mentionItems.value.length; return }
    if (event.key === 'ArrowUp') { event.preventDefault(); mentionIndex.value = (mentionIndex.value - 1 + mentionItems.value.length) % mentionItems.value.length; return }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { event.preventDefault(); selectComposerMention(mentionItems.value[mentionIndex.value].key); return }
    if (event.key === 'Escape') { event.preventDefault(); mentionDismissed.value = true; return }
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
}
const memoryPickerOpen = ref(false)
const selectedMemoryFiles = ref<Array<'summary' | 'profile'>>([])
const bookPickerOpen = ref(false)
const selectedBookReferences = ref<SelectedBookReference[]>([])
const readingPickerOpen = ref(false)
const selectedReadingReferences = ref<SelectedReadingReference[]>([])
const questionPickerOpen = ref(false)
const selectedQuestionIds = ref<number[]>([])
const toolOptions = ['brainstorm', 'web_search', 'paper_search', 'zotero_search', 'reason', 'geogebra_analysis', 'imagegen', 'videogen']
const enabledTools = ref<Set<string>>(new Set(toolOptions))
const editingMessage = ref<number | null>(null)
const failedSubmission = ref<FailedSubmission | null>(null)
const submissionIdOverride = ref('')
const previewAttachment = ref<ChatAttachment | null>(null)
const traceOpen = ref(false)
const traceMessageId = ref<number | null>(null)
const traceViewer = ref<InstanceType<typeof TraceViewer> | null>(null)
function openTrace(message: Message) { if (typeof message.id !== 'number') return; traceMessageId.value = message.id; traceOpen.value = true; void nextTick(() => traceViewer.value?.reopen()) }
function closeTrace() { traceOpen.value = false }
const activityOpen = ref(localStorage.getItem('dt:chat:viewer-panel') === '1')
const activityTab = ref<'activity' | 'attachments' | 'note' | 'side-chat'>('activity')
const capabilityNeedsConfig = computed(() =>
  selectedCapability.value === 'deep_research' || selectedCapability.value === 'visualize',
)
const viewerPanel = ref<InstanceType<typeof SessionViewerPanel> | null>(null)
const sessionMenuOpen = ref(false)
const workspaces = ref<WorkspaceOption[]>([])
const taskBoard = ref<TaskBoard | null>(null)
const draftTaskIds = ref<string[]>([])
const sessionResourcesLoaded = ref(false)
const movingWorkspace = ref(false)
const saveDialogOpen = ref(false)
const currentSession = computed(() => sessions.value.find(item => item.id === routeSessionId.value) || null)
const historyReferences = computed(() => Array.from(new Set([...(props.reading ? props.linkedSessionIds : []), ...selectedHistorySessions.value.map(item => item.sessionId), ...selectedAgentSessions.value.map(item => item.sessionId)])))
const currentWorkspaceId = computed(() => currentSession.value?.content_workspace_id || String(currentSession.value?.preferences?.workspace_id || ''))
const currentTaskLink = computed(() => taskBoard.value?.session_links?.find(link => link.session_id === routeSessionId.value && link.workspace_id === currentWorkspaceId.value) || null)
const renamingSession = ref(false)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const customizeOpen = ref(false)
const showSettings = ref(localStorage.getItem('deeptutor.chat.settings') !== 'false')
const showStarters = ref(localStorage.getItem('deeptutor.chat.starters') !== 'false')
const noteContent = ref('')
const allAttachments = computed(() => visibleMessages.value.flatMap(message => message.attachments || []))
watch(noteContent, value => { if (routeSessionId.value) localStorage.setItem(`deeptutor.chat.note.${routeSessionId.value}`, value) })
watch(routeSessionId, id => { noteContent.value = id ? localStorage.getItem(`deeptutor.chat.note.${id}`) || '' : ''; sessionMenuOpen.value = false; renamingSession.value = false; sessionResourcesLoaded.value = false })
watch(activityOpen, value => localStorage.setItem('dt:chat:viewer-panel', value ? '1' : '0'))
watch(capabilityNeedsConfig, (next, previous) => {
  if (!previous && next) activityOpen.value = true
})
watch(showSettings, value => localStorage.setItem('deeptutor.chat.settings', String(value)))
watch(showStarters, value => localStorage.setItem('deeptutor.chat.starters', String(value)))
const capabilityConfigStorageKey = computed(() => `dt:chat:capability-config:${routeSessionId.value || 'pending'}`)
let lastHydratedCapabilityConfigKey = ''
watch(capabilityConfigStorageKey, key => {
  if (lastHydratedCapabilityConfigKey === key) return
  lastHydratedCapabilityConfigKey = key
  researchConfig.value = createEmptyResearchConfig()
  researchConfigConfirmed.value = false
  visualizeConfig.value = { ...DEFAULT_VISUALIZE_CONFIG }
  visualizeConfigConfirmed.value = false
  let raw = ''
  try { raw = localStorage.getItem(key) || '' } catch { raw = '' }
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as {
      researchConfig?: DeepResearchFormConfig
      visualizeConfig?: VisualizeFormConfig
      researchConfigConfirmed?: boolean
      visualizeConfigConfirmed?: boolean
    }
    if (parsed.researchConfig) researchConfig.value = normalizeResearchConfig(parsed.researchConfig as unknown as Record<string, unknown>)
    if (parsed.visualizeConfig) visualizeConfig.value = { ...DEFAULT_VISUALIZE_CONFIG, ...parsed.visualizeConfig }
    if (typeof parsed.researchConfigConfirmed === 'boolean') researchConfigConfirmed.value = parsed.researchConfigConfirmed
    if (typeof parsed.visualizeConfigConfirmed === 'boolean') visualizeConfigConfirmed.value = parsed.visualizeConfigConfirmed
  } catch {
    /* Corrupted local config is ignored, matching React's storage guard. */
  }
}, { immediate: true })
watch([capabilityConfigStorageKey, researchConfig, researchConfigConfirmed, visualizeConfig, visualizeConfigConfirmed], ([key]) => {
  try {
    localStorage.setItem(
      String(key),
      JSON.stringify({
        researchConfig: researchConfig.value,
        researchConfigConfirmed: researchConfigConfirmed.value,
        visualizeConfig: visualizeConfig.value,
        visualizeConfigConfirmed: visualizeConfigConfirmed.value,
      }),
    )
  } catch {
    /* Storage can be unavailable; the turn remains sendable. */
  }
})
function sessionPath(id: string) {
  return props.noteDocumentId ? { path: chatBase.value, query: { chat: id } } : `${chatBase.value}/${encodeURIComponent(id)}`
}
type StartPayloadOptions = {
  capability?: string
  config?: Record<string, unknown>
  persistUserMessage?: boolean
}

function startTurnConfig(extraConfig?: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  if (selectedCapability.value === 'visualize') {
    Object.assign(config, buildVisualizeWSConfig(visualizeConfig.value))
  }
  const hasResearchBase =
    typeof extraConfig?.mode === 'string' && typeof extraConfig?.depth === 'string'
  if (selectedCapability.value === 'deep_research' && !hasResearchBase) {
    Object.assign(config, buildResearchWSConfig(researchConfig.value))
  }
  Object.assign(config, extraConfig ?? {})
  if (!routeSessionId.value && draftTaskIds.value.length) config.linked_task_ids = [...draftTaskIds.value]
  return config
}

function startPayload(content: string, submissionId: string, attachments: ChatAttachment[] = pendingAttachments.value, editingId: number | null = editingMessage.value, action: MasterySubmissionAction | null = masteryAction.value, parentMessageId: number | null = null, options: StartPayloadOptions = {}) {
  const config = startTurnConfig(options.config)
  const reuse = mainResourceReuse.value
  config._resource_reuse = reuse
  config._persistent_knowledge_bases = retainedKnowledgeBases(
    selectedKbs.value,
    new Set(connectedAgents.value.map(agent => agent.name)),
    reuse,
  )
  return { type: 'start_turn', content, client_submission_id: submissionId,
    capability: options.capability ?? (props.mastery ? 'mastery_path' : props.reading ? 'immersive_reading' : selectedCapability.value),
    persist_user_message: options.persistUserMessage ?? true,
    language: replyLanguageOverride.value || accountResponseLanguage.value,
    ...(!routeSessionId.value && replyLanguageOverride.value ? { reply_language_override: replyLanguageOverride.value } : {}),
    ...(props.mastery ? { mastery_path_id: masteryPathId.value, mastery_session_mode: mode.value } : {}),
    ...(action?.masteryAnswer ? { mastery_answer: action.masteryAnswer } : {}),
    ...(action?.masterySkip ? { mastery_skip: action.masterySkip } : {}),
    ...(props.reading ? { workspace_mode: 'immersive_reading', reading_workspace_id: readingWorkspaceId.value, reading_material_id: props.materialId || undefined } : {}),
    ...(historyReferences.value.length ? { history_references: historyReferences.value } : {}),
    ...(selectedMemoryFiles.value.length ? { memory_references: [...selectedMemoryFiles.value] } : {}),
    ...(selectedBookReferences.value.length ? { book_references: selectedBooksToPayload(selectedBookReferences.value) } : {}),
    ...(selectedReadingReferences.value.length ? { reading_references: selectedReadingsToPayload(selectedReadingReferences.value) } : {}),
    ...(selectedQuestionIds.value.length ? { question_notebook_references: [...selectedQuestionIds.value] } : {}),
    ...(props.reading && props.readingSelection ? { reading_material_revision: props.readingRevision || 1, reading_references: [{ material_id: props.materialId, revision: props.readingRevision || 1, locators: [props.readingLocator || 1] }], reading_viewport: { locator: props.readingLocator || 1, selection: props.readingSelection } } : {}),
    ...(props.noteDocumentId ? { note_document_id: props.noteDocumentId } : {}),
    ...(selectedPartner.value ? { consult_partner_id: selectedPartner.value } : {}),
    ...(selectedPartnerGroup.value ? { partner_discussion_group_id: selectedPartnerGroup.value } : {}),
    ...(answeredAgent.value ? { subagent_consult_budget: subagentBudget.value } : {}),
    answer_by: answerBy.value || null,
    ...(Object.keys(config).length ? { config } : {}),
    ...(props.noteGeneration ? { note_generation: { block_id: props.noteGeneration.block_id, kind: props.noteGeneration.kind, ...(props.noteGeneration.config ? { config: props.noteGeneration.config } : {}) } } : {}),
    ...(attachments.length ? { attachments: attachments.map(({ type, filename, base64, mime_type, url }) => ({ type, filename, base64, mime_type, url })) } : {}),
    ...(selectedModel.value ? { llm_selection: Object.fromEntries(selectedModel.value.split(':').map((part, index) => [index === 0 ? 'profile_id' : 'model_id', part])) } : {}),
    knowledge_bases: [...selectedKbs.value], skills: [...selectedSkills.value], mcp: [...selectedMcp.value], persona: selectedPersona.value || null,
    notebook_references: selectedRecordsToPayload(selectedNotebookRecords.value), tools: [...enabledTools.value],
    ...(activeSessionId ? { session_id: activeSessionId } : {}),
    ...(editingId !== null ? { regenerate: true, parent_message_id: parentMessageId, regenerated_from_message_id: editingId } : parentMessageId !== null ? { parent_message_id: parentMessageId } : {}) }
}
const masteryGrades = computed(() => collectMasteryGrades(visibleMessages.value))
const masterySkips = computed(() => new Set([...collectMasterySkips(messages.value), ...skippedMasteryQuestions.value]))
function masteryQuestionsFor(message: Message) { return props.mastery ? collectMasteryQuestions(message.events) : [] }
function answerMasteryQuestion(answer: { questionId: string; text: string; answers: Array<{ questionId: string; text: string }> }) {
  if (busy.value || !answer.text.trim()) return false
  masteryAction.value = { masteryAnswer: { question_id: answer.questionId, text: answer.text.trim(), answers: Object.fromEntries(answer.answers.map(item => [item.questionId, item.text])) } }
  answeredMasteryQuestions.value = new Set([...answeredMasteryQuestions.value, answer.questionId, ...answer.answers.map(item => item.questionId)])
  prompt.value = answer.text.trim()
  void nextTick(() => submit())
  return true
}
function skipMasteryQuestion(questionId: string) {
  if (busy.value || !questionId) return false
  masteryAction.value = { masterySkip: { question_id: questionId } }
  skippedMasteryQuestions.value = new Set([...skippedMasteryQuestions.value, questionId])
  prompt.value = '我们先跳过这道题。'
  void nextTick(() => submit())
  return true
}
function challengeMasteryQuestion(questionId: string) {
  if (busy.value) return false
  masteryAction.value = null
  prompt.value = `请根据原始资料证据复核评估 ${questionId}。如果证据不足，请撤销评估并重新计算学习状态；不要仅因为我提出质疑就判定已掌握。`
  void nextTick(() => submit())
  return true
}
const sessions = ref<Session[]>([])
const messages = ref<Message[]>([])
const selectedBranches = ref<Record<string, number>>({})
const branchView = computed(() => buildVisiblePath(messages.value, selectedBranches.value))
const visibleMessages = computed(() => branchView.value.messages)
const handledSetupSync = new Set<string>()
watch(
  [visibleMessages, streamEvents],
  () => {
    const fresh = collectAppliedSettingIds(visibleMessages.value).filter(id => !handledSetupSync.has(id))
    if (!fresh.length) return
    for (const id of fresh) handledSetupSync.add(id)
    void refreshSetupUi().catch(() => {
      // The server value is durable; the next page load will pick it up.
    })
  },
  { deep: true },
)
watch(
  [visibleMessages, streamEvents],
  () => {
    const groups = groupSubagentEvents([
      ...visibleMessages.value,
      { events: streamEvents.value },
    ])
    for (const group of groups) {
      viewerPanel.value?.openSubagentTab(group.key, group.label, group.events)
    }
  },
  { deep: true },
)
type MessageRow = {
  message: Message
  originalIndex: number
  outlineStatus?: DeepResearchStatus
}
const deepResearchPresentation = computed(() => buildDeepResearchPresentation(visibleMessages.value))
const messageRows = computed<MessageRow[]>(() => {
  const rows: MessageRow[] = []
  visibleMessages.value.forEach((message, originalIndex) => {
    if (deepResearchPresentation.value.followupIndices.has(originalIndex)) return
    const merged = deepResearchPresentation.value.mergedByParent.get(originalIndex)
    rows.push({
      message: merged
        ? {
            ...message,
            events: merged.mergedEvents as TurnEvent[],
            content: merged.mergedContent,
          }
        : message,
      originalIndex,
      outlineStatus: deepResearchPresentation.value.statusByParent.get(originalIndex),
    })
  })
  return rows
})
const sessionUsage = computed(() => cumulativeMessageUsage(visibleMessages.value))
const contextBudget = computed(() => latestContextBudget(visibleMessages.value))
function hasMessageUsage(message: Message) { return message.role === 'assistant' && Boolean(messageUsage(message.events)) }
function messageUsageFor(message: Message) { return messageUsage(message.events) || {} }
function sessionUsageFor(index: number) { return sessionUsage.value[index] || {} }
const chatOutline = computed(() => buildChatOutline(messages.value, selectedBranches.value))
const messageList = ref<HTMLElement | null>(null)
const selectedPassage = ref<SelectedPassage | null>(null)
const shouldAutoScroll = ref(true)
const voiceAutoplay = ref(false)
const freshlyCompletedAssistantId = ref<number | null>(null)
function markFreshlyCompletedAssistant() { for (let index = visibleMessages.value.length - 1; index >= 0; index -= 1) { const message = visibleMessages.value[index]; if (message.role === 'assistant') { freshlyCompletedAssistantId.value = message.id ?? null; return } } }
function handleVoiceAutoplayPreference(event: Event) { voiceAutoplay.value = Boolean((event as CustomEvent).detail?.value) }
function scrollMessagesToBottom(behavior: ScrollBehavior = 'instant' as ScrollBehavior) {
  void nextTick(() => {
    const root = messageList.value
    if (!root || !shouldAutoScroll.value) return
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: root.scrollHeight, behavior })
    else root.scrollTop = root.scrollHeight
  })
}
function handleMessageScroll() {
  const root = messageList.value
  if (!root) return
  const distance = root.scrollHeight - root.scrollTop - root.clientHeight
  if (distance < 80) shouldAutoScroll.value = true
  else if (!busy.value) shouldAutoScroll.value = false
}
function latestAssistantMessageId(): number | null {
  for (let index = visibleMessages.value.length - 1; index >= 0; index -= 1) {
    const message = visibleMessages.value[index]
    if (message.role === 'assistant' && typeof message.id === 'number') return message.id
  }
  return null
}
function captureSelection() {
  window.setTimeout(() => {
    const selection = window.getSelection()
    const text = selection?.toString().trim().slice(0, 12_000) || ''
    if (!selection || selection.rangeCount === 0 || !text) return
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    const element = container.nodeType === Node.ELEMENT_NODE ? container as Element : container.parentElement
    if (!element || !messageList.value?.contains(element)) return
    const rect = range.getBoundingClientRect()
    const messageElement = element.closest?.('[data-chat-message-id]')
    const messageId = messageElement ? Number(messageElement.getAttribute('data-chat-message-id')) : NaN
    selectedPassage.value = {
      text,
      messageId: Number.isFinite(messageId) ? messageId : latestAssistantMessageId(),
      anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    }
  }, 0)
}
function dismissSelection(event?: Event) {
  const target = event?.target as Element | null
  if (target?.closest?.('.selection-actions')) return
  selectedPassage.value = null
}
const pendingQuoteAttachments = computed(() =>
  pendingAttachments.value
    .map((attachment, index) => ({ attachment, index }))
    .filter(item => isQuoteAttachment(item.attachment))
    .map(item => ({ index: item.index, text: quoteText(item.attachment) }))
    .filter(item => item.text),
)
const regularPendingAttachments = computed(() =>
  pendingAttachments.value
    .map((attachment, index) => ({ attachment, index }))
    .filter(item => !isQuoteAttachment(item.attachment)),
)
const selectedReferenceItems = computed<ContextTreeItem[]>(() => {
  const items: ContextTreeItem[] = []
  if (selectedPersona.value) items.push({ key: 'persona', icon: 'profile', kind: 'Persona', label: selectedPersona.value })
  if (selectedQuestionIds.value.length) items.push({ key: 'questions', icon: 'questions', kind: '题库', label: `题库题目（${selectedQuestionIds.value.length}）` })
  const notebookGroups = new Map<string, { name: string; count: number }>()
  for (const record of selectedNotebookRecords.value) {
    const current = notebookGroups.get(record.notebookId)
    notebookGroups.set(record.notebookId, { name: record.notebookName, count: (current?.count || 0) + 1 })
  }
  for (const [id, group] of notebookGroups) items.push({ key: `notebook-${id}`, icon: 'bookmark', kind: '收藏', label: `${group.name}（${group.count}）` })
  for (const book of selectedBookReferences.value) items.push({ key: `book-${book.bookId}`, icon: 'book', kind: '书籍', label: `${book.bookTitle}（${book.pages.length}）` })
  for (const material of selectedReadingReferences.value) items.push({ key: `reading-${material.materialId}`, icon: 'reading', kind: '阅读', label: `${material.materialTitle}（${countSelectedReadingUnits([material])}）` })
  for (const agent of selectedAgentSessions.value) items.push({ key: `agent-${agent.sessionId}`, icon: 'agents', kind: '智能体', label: agent.title })
  for (const history of selectedHistorySessions.value) items.push({ key: `history-${history.sessionId}`, icon: 'history', kind: '历史', label: history.title || '新对话' })
  for (const memory of selectedMemoryFiles.value) items.push({ key: `memory-${memory}`, icon: 'memory', kind: '记忆', label: memory === 'summary' ? '摘要' : '档案' })
  for (const kb of knowledgeBases.value) {
    if (!selectedKbs.value.has(kb.name) || ['subagent', 'partner'].includes(String(kb.metadata?.type || ''))) continue
    items.push({ key: `kb-${kb.name}`, icon: 'knowledge', kind: '知识库', label: kb.name })
  }
  for (const skill of skillOptions.value) {
    if (selectedSkills.value.has(skill.id)) items.push({ key: `skill-${skill.id}`, icon: 'capability', kind: '技能', label: skill.name, previewable: false })
  }
  for (const connector of mcpOptions.value) {
    if (selectedMcp.value.has(connector.id)) items.push({ key: `mcp-${connector.id}`, icon: 'connectors', kind: 'MCP', label: connector.name, previewable: false })
  }
  return items
})
function previewReferenceItem(item: ContextTreeItem) {
  if (item.key === 'persona') personaPickerOpen.value = true
  else if (item.key === 'questions') questionPickerOpen.value = true
  else if (item.key.startsWith('notebook-')) notebookPickerOpen.value = true
  else if (item.key.startsWith('book-')) bookPickerOpen.value = true
  else if (item.key.startsWith('reading-')) readingPickerOpen.value = true
  else if (item.key.startsWith('agent-')) agentsPickerOpen.value = true
  else if (item.key.startsWith('history-')) historyPickerOpen.value = true
  else if (item.key.startsWith('memory-')) memoryPickerOpen.value = true
  else if (item.key.startsWith('kb-') && !resourcesOpen.value) toggleResources()
}
function removeReferenceItem(item: ContextTreeItem) {
  if (item.key === 'persona') selectedPersona.value = ''
  else if (item.key === 'questions') selectedQuestionIds.value = []
  else if (item.key.startsWith('notebook-')) {
    const id = item.key.slice('notebook-'.length)
    selectedNotebookRecords.value = selectedNotebookRecords.value.filter(record => record.notebookId !== id)
  } else if (item.key.startsWith('book-')) selectedBookReferences.value = selectedBookReferences.value.filter(book => book.bookId !== item.key.slice(5))
  else if (item.key.startsWith('reading-')) selectedReadingReferences.value = selectedReadingReferences.value.filter(material => material.materialId !== item.key.slice(8))
  else if (item.key.startsWith('agent-')) selectedAgentSessions.value = selectedAgentSessions.value.filter(agent => agent.sessionId !== item.key.slice(6))
  else if (item.key.startsWith('history-')) selectedHistorySessions.value = selectedHistorySessions.value.filter(history => history.sessionId !== item.key.slice(8))
  else if (item.key.startsWith('memory-')) selectedMemoryFiles.value = selectedMemoryFiles.value.filter(memory => memory !== item.key.slice(7))
  else if (item.key.startsWith('kb-')) selectedKbs.value.delete(item.key.slice(3))
  else if (item.key.startsWith('skill-')) selectedSkills.value.delete(item.key.slice(6))
  else if (item.key.startsWith('mcp-')) selectedMcp.value.delete(item.key.slice(4))
}
function addSelectionToChat() {
  if (!selectedPassage.value) return
  const quote = quoteAttachment(selectedPassage.value.text)
  if (quote) {
    pendingAttachments.value.push({
      type: quote.type,
      filename: quote.filename,
      base64: quote.base64,
      mime_type: quote.mime_type,
      extracted_text: quote.text,
      text: quote.text,
    })
  }
  selectedPassage.value = null
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('form.composer textarea')?.focus())
}
function removePendingAttachment(index: number) {
  const attachment = pendingAttachments.value[index]
  if (attachment) pendingAttachments.value.splice(index, 1)
}
function openSelectionSideChat(responder: SideChatResponder) {
  if (!selectedPassage.value) return
  const passage = selectedPassage.value
  selectedPassage.value = null
  activityOpen.value = true
  void nextTick(() => {
    viewerPanel.value?.openSideChat({
      responder,
      quote: passage.text,
      seedId: passage.messageId || undefined,
    })
  })
}
function releaseMessageFollow() {
  // A deliberate reading gesture releases the pin even before the browser
  // applies the scroll delta; position-only release misses the first wheel tick.
  shouldAutoScroll.value = false
}
function messageSibling(message: Message): SiblingInfo | undefined { return message.id === undefined ? undefined : branchView.value.siblingsByMessageId.get(message.id) }
function pairedUserMessage(index: number): Message | null { for (let at = index - 1; at >= 0; at -= 1) { if (visibleMessages.value[at].role === 'user') return visibleMessages.value[at] }; return null }
function canDeleteMessage(message: Message, index: number): boolean { const id = pairedUserMessage(index)?.id; return message.role === 'assistant' && typeof id === 'number' && id > 0 }
function submissionParentId(editingId: number | null): number | null { if (editingId !== null) return messages.value.find(message => message.id === editingId)?.parentMessageId ?? null; return tipMessageId(visibleMessages.value) }
async function switchBranch(parentId: number | null, childId: number) {
  const key = parentId === null ? 'null' : String(parentId)
  selectedBranches.value = { ...selectedBranches.value, [key]: childId }
  if (!routeSessionId.value || childId < 0) return
  const persisted = Object.fromEntries(Object.entries(selectedBranches.value).filter(([, id]) => id > 0))
  try { await api(`/api/sessions/${encodeURIComponent(routeSessionId.value)}/branch-selection`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected_branches: persisted }) }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '分支选择保存失败' }
}
async function deleteTurn(messageId: number) {
  if (!routeSessionId.value || busy.value || messageId <= 0) return
  try {
    await api(`/api/sessions/${encodeURIComponent(routeSessionId.value)}/messages/${messageId}`, { method: 'DELETE' })
    await refresh()
    notice.value = '本轮对话已删除'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除本轮对话失败' }
}
function deleteTurnForMessage(index: number) { const id = pairedUserMessage(index)?.id; if (typeof id === 'number') void deleteTurn(id) }
const prompt = ref('')
watch(prompt, () => void nextTick(resizeComposerTextarea))
watch(modeLeadElement, () => {
  let observer: ResizeObserver | undefined
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      leadTextIndent.value = modeLeadElement.value?.offsetWidth || 0
    })
    if (modeLeadElement.value) observer.observe(modeLeadElement.value)
  }
  leadTextIndent.value = modeLeadElement.value?.offsetWidth || 0
  onWatcherCleanup(() => observer?.disconnect())
})
watch(prompt, () => { slashIndex.value = 0; slashDismissed.value = false; mentionDismissed.value = false; mentionIndex.value = 0 })
const streaming = ref('')
watch([isNewConversation, isStandardConversation], () => void nextTick(resizeComposerTextarea))
const busy = ref(false)
watch([streaming, () => messages.value.length, () => streamEvents.value.length], () => { if (shouldAutoScroll.value) scrollMessagesToBottom() })
watch(busy, value => { if (value) { shouldAutoScroll.value = true; scrollMessagesToBottom() } })
watch([busy, routeSessionId, () => messages.value.length, masteryTopic], () => { if (props.mastery && !busy.value) void loadMasteryAskHint() })
watch([busy, () => messages.value.length, selectedCapability], () => {
  if (busy.value || selectedCapability.value !== 'deep_research') return
  const latestAssistant = [...visibleMessages.value].reverse().find(message => message.role === 'assistant')
  if (!latestAssistant || !shouldReturnToChatAfterResearch(latestAssistant.events)) return
  const terminal = [...(latestAssistant.events ?? [])].reverse().find(event => event.type === 'done')
  const turnKey = String(terminal?.turn_id || latestAssistant.id || '')
  if (!turnKey || returnedResearchTurnKey.value === turnKey) return
  returnedResearchTurnKey.value = turnKey
  selectedCapability.value = 'chat'
})
const error = ref('')
const notice = ref('')
const waitingForReply = ref(false)
const reply = ref('')
const connection = ref('idle')
let socket: WebSocket | null = null
let activeSessionId: string | null = null
let activeTurnId: string | null = null
let lastSeq = 0
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let titleTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
let reconnectAttempt = 0
let lastActivityAt = Date.now()
let idleWatchdog: ReturnType<typeof setInterval> | undefined
let disposed = false

function clearTimers() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (titleTimer) clearTimeout(titleTimer)
  if (closeTimer) clearTimeout(closeTimer)
}
function send(value: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ protocol_version: '2.0', ...value }))
}
function connect(start?: { content: string; submissionId: string; attachments: ChatAttachment[]; editingMessageId?: number | null; masteryAction?: MasterySubmissionAction | null; parentMessageId?: number | null }, command?: Record<string, unknown>) {
  if (disposed || socket && socket.readyState <= WebSocket.OPEN) return
  connection.value = activeTurnId ? 'recovering' : 'connecting'
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}${scopedUrl('/ws')}`)
  socket = ws
  ws.onopen = () => {
    if (socket !== ws) return
    connection.value = 'connected'; reconnectAttempt = 0
    if (command) send(command)
    else if (activeTurnId) send({ type: 'resume_from', turn_id: activeTurnId, seq: lastSeq })
    else if (start) send(startPayload(start.content, start.submissionId, start.attachments, start.editingMessageId, start.masteryAction, start.parentMessageId ?? null))
    else if (activeSessionId) send({ type: 'check_active_turn', session_id: activeSessionId })
  }
  ws.onmessage = event => {
    if (socket !== ws) return
    let value: TurnEvent
    try { value = JSON.parse(event.data) as TurnEvent } catch { return }
    lastActivityAt = Date.now()
    if (value.type === 'active_turn_info') {
      if (value.turn_id && ['running', 'queued', 'waiting_input', 'recovering'].includes(value.status || '')) {
        activeTurnId = value.turn_id; busy.value = true
        lastActivityAt = Date.now()
        send({ type: 'resume_from', turn_id: activeTurnId, seq: lastSeq })
      } else if (busy.value) { busy.value = false; void refresh() }
      return
    }
    if (value.type === 'protocol_error') {
      error.value = value.message || '对话协议错误'
      if (!value.turn_id) { busy.value = false; connection.value = 'idle' }
      return
    }
    if (value.type === 'command_ack') {
      if (value.accepted === false) error.value = value.message || '操作未被接受'
      return
    }
    if (value.session_id) {
      activeSessionId = value.session_id
      if (!routeSessionId.value) void router.replace(sessionPath(value.session_id))
    }
    if (value.turn_id && value.turn_id !== activeTurnId) { activeTurnId = value.turn_id; lastSeq = 0; clearFailedSubmission() }
    if (typeof value.seq === 'number') {
      if (value.seq <= lastSeq) return
      if (value.seq > lastSeq + 1 && activeTurnId) { send({ type: 'resume_from', turn_id: activeTurnId, seq: lastSeq }); return }
      lastSeq = value.seq
    }
    if (!['content', 'session_meta', 'done', 'active_turn_info', 'command_ack'].includes(value.type)) streamEvents.value.push(value)
    if (value.type === 'content') streaming.value += value.content || ''
    if (value.type === 'wait_for_input') waitingForReply.value = true
    if (value.type === 'error') error.value = value.content || value.message || '对话失败'
    if (value.type === 'session_meta') void loadSessions().catch(() => null)
    if (value.type === 'done') {
      if (!resourceReuse.value.agents) selectedAgentSessions.value = []
      if (!resourceReuse.value.history) selectedHistorySessions.value = []
      if (!resourceReuse.value.memory) selectedMemoryFiles.value = []
      if (!resourceReuse.value.books) selectedBookReferences.value = []
      if (!resourceReuse.value.reading) selectedReadingReferences.value = []
      if (!resourceReuse.value.questions) selectedQuestionIds.value = []
      if (!resourceReuse.value.notebooks) selectedNotebookRecords.value = []
      if (!resourceReuse.value.skills) selectedSkills.value = new Set()
      if (!resourceReuse.value.mcp) selectedMcp.value = new Set()
      if (!resourceReuse.value.persona) selectedPersona.value = ''
      if (!resourceReuse.value.partner) selectedPartner.value = ''
      if (!resourceReuse.value.partner_group) selectedPartnerGroup.value = ''
      if (!resourceReuse.value.agent) selectConsultAgent('')
      busy.value = false; waitingForReply.value = false; connection.value = 'idle'
      emit('turnComplete')
      streaming.value = ''
      void refresh().then(() => { if (!disposed) markFreshlyCompletedAssistant() })
      titleTimer = setTimeout(() => { void loadSessions().catch(() => null) }, 5000)
      // Title generation can publish session_meta after done.
      closeTimer = setTimeout(() => { if (socket === ws) { socket = null; ws.close() } }, 15000)
    }
  }
  ws.onerror = () => { if (socket === ws) connection.value = 'recovering' }
  ws.onclose = () => {
    if (socket !== ws) return
    socket = null
    if (disposed || !busy.value) return
    if (!activeTurnId && !activeSessionId) {
      busy.value = false; connection.value = 'idle'
      error.value = '连接中断。请查看会话记录，再决定是否重新发送。'
      return
    }
    connection.value = 'recovering'
    const attempt = reconnectAttempt++
    if (!shouldReconnect({ attempt, activeTurnId, pageVisible: typeof document === 'undefined' || !document.hidden })) {
      busy.value = false
      connection.value = 'idle'
      error.value = '连接中断且重连次数已达上限。请查看会话记录，再决定是否重新发送。'
      return
    }
    reconnectTimer = setTimeout(() => connect(), reconnectDelay(attempt))
  }
}
async function refresh() {
  try { await Promise.all([loadSessions(), loadSession(), ...(props.mastery ? [loadMasteryTopic()] : [])]) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '刷新会话失败' }
}

async function loadSessions() {
  if (props.noteDocumentId) {
    const result = await api<{ threads: Array<Session & { session_id: string }> }>(`/api/documents/${encodeURIComponent(props.noteDocumentId)}/threads`)
    sessions.value = result.threads.map(item => ({ ...item, id: item.session_id }))
  } else if (props.mastery) {
    const result = await api<{ sessions: Array<Session & { session_id: string }> }>(`/api/mastery-paths/topics/${encodeURIComponent(masteryPathId.value)}/sessions`)
    sessions.value = result.sessions.map(item => ({ ...item, id: item.session_id }))
  } else if (props.reading) {
    const result = await api<{ sessions: Array<Session & { session_id: string }> }>(`/api/reading/workspaces/${encodeURIComponent(readingWorkspaceId.value)}/sessions`)
    sessions.value = result.sessions.map(item => ({ ...item, id: item.session_id }))
  } else {
    const result = await api<{ sessions: Session[] }>('/api/sessions?limit=200')
    sessions.value = result.sessions
  }
}
async function loadSession() {
  const id = routeSessionId.value
  if (!id) { messages.value = []; selectedBranches.value = {}; sessionLoadedId.value = ''; sessionLoading.value = false; sessionError.value = ''; return }
  if (props.mastery) { sessionLoading.value = sessionLoadedId.value !== id; sessionError.value = '' }
  try {
  const session = await api<Session>(`/api/sessions/${encodeURIComponent(id)}`)
  const rawMessages = session.messages || []
  const hasParentPointers = rawMessages.some(message => message.parentMessageId !== undefined || message.parent_message_id !== undefined)
  messages.value = rawMessages.map((message, index) => ({ ...message, parentMessageId: hasParentPointers ? (message.parentMessageId ?? message.parent_message_id ?? null) : (index === 0 ? null : rawMessages[index - 1].id ?? null) }))
  sessionLoadedId.value = id
  if (!props.mastery && !props.reading && !props.noteDocumentId && typeof session.preferences?.capability === 'string') selectedCapability.value = session.preferences.capability
  const preferences = session.preferences || {}
  replyLanguageOverride.value = isResponseLanguage(preferences.reply_language_override) ? preferences.reply_language_override : null
  selectedBranches.value = Object.fromEntries(Object.entries((preferences.selected_branches || {}) as Record<string, unknown>).filter(([, value]) => typeof value === 'number').map(([key, value]) => [key, Number(value)]))
  const llm = preferences.llm_selection as { profile_id?: string; model_id?: string } | undefined
  if (llm?.profile_id && llm.model_id) selectedModel.value = `${llm.profile_id}:${llm.model_id}`
  if (Array.isArray(preferences.knowledge_bases)) selectedKbs.value = new Set(preferences.knowledge_bases.map(String))
  if (Array.isArray(preferences.skills)) selectedSkills.value = new Set(preferences.skills.map(String))
  if (Array.isArray(preferences.mcp)) selectedMcp.value = new Set(preferences.mcp.map(String))
  if (typeof preferences.persona === 'string') selectedPersona.value = preferences.persona
  if (typeof preferences.answer_by === 'string') answerBy.value = preferences.answer_by
  if (session.messages?.some(message => message.metadata?.client_submission_id === failedSubmission.value?.submissionId)) clearFailedSubmission()
  if (props.mastery) {
    const saved = String(session.preferences?.mastery_session_mode || '')
    if (saved === 'outline' || saved === 'study' || saved === 'review') mode.value = saved
  }
  if (!busy.value && session.active_turn_id && ['running', 'queued', 'waiting_input', 'recovering'].includes(session.status || '')) {
    activeSessionId = id; activeTurnId = session.active_turn_id; lastSeq = 0
    busy.value = true; connect()
  }
  } catch (cause) {
    if (props.mastery) sessionError.value = cause instanceof Error ? cause.message : '会话打开失败'
    throw cause
  } finally {
    if (props.mastery) sessionLoading.value = false
  }
}
// Idle recovery watchdog — port of ChatStateAdapter's 10s interval. A quiet
// streaming turn re-subscribes from the last sequence so the backend replays
// buffered events (including a missed terminal event).
function startIdleWatchdog() {
  if (idleWatchdog) clearInterval(idleWatchdog)
  idleWatchdog = setInterval(() => {
    if (disposed) return
    const decision = decideIdleTurnRecovery({
      isStreaming: busy.value,
      hasPendingUserInput: waitingForReply.value,
      activeTurnId,
      lastSeq,
      updatedAt: lastActivityAt,
      now: Date.now(),
      idleTimeoutMs: readStoredChatResponseTimeout() * 1000,
    })
    if (decision.kind === 'none') return
    if (decision.kind === 'resubscribe') {
      // Touch the timestamp so we do not re-fire on every tick while opening.
      lastActivityAt = Date.now()
      if (socket?.readyState === WebSocket.OPEN) {
        send(buildResumeTurn(decision.turnId, decision.afterSeq))
      } else {
        // Socket is down; the reconnect path already sends resume_from on open.
        connect()
      }
    } else {
      // reconcile: no turn id yet — nudge the timestamp and let check_active_turn run
      lastActivityAt = Date.now()
    }
  }, 10_000)
}

onMounted(() => {
  startIdleWatchdog()
  const hour = new Date().getHours()
  const choices = hour >= 5 && hour < 12
    ? ['早上好。', '早上好——今天想学点什么？', '今天想学什么？']
    : hour >= 12 && hour < 17
      ? ['下午好。', '下午好——有什么想聊的？', '今天想学什么？']
      : hour >= 17 && hour < 22
        ? ['晚上好。', '晚上好——想探索点什么？', '今天想学什么？']
        : ['今天也很晚呢。', '还在挑灯夜读吗？', '今天想学什么？']
  welcomeGreeting.value = choices[Math.floor(Math.random() * choices.length)]
  document.addEventListener('click', closeCapabilityMenu)
  document.addEventListener('pointerdown', dismissSelection)
  window.addEventListener('storage', syncTrayFold)
  window.addEventListener(TRAY_FOLD_EVENT, syncTrayFoldEvent)
  window.addEventListener('deeptutor:voice-autoplay-global', handleVoiceAutoplayPreference)
  void loadVoicePreferences().then(result => { voiceAutoplay.value = result.autoplay })
  void api<PageCustomization>('/api/settings/page-customization').then(result => { if (result?.chat?.controls) customization.value = result }).catch(() => null)
  restoreFailedSubmission()
  void loadSessions().catch(e => { error.value = String(e) })
  void nextTick(resizeComposerTextarea)
  void loadResources()
  void loadAttachmentLimits().then(result => { attachmentLimits.value = result })
  if (props.mastery) void loadMasteryTopic()
  void api<any>('/api/capabilities/registered').then(payload => {
    const rows = Array.isArray(payload) ? payload : payload.capabilities || payload.registered || []
    if (rows.length) capabilities.value = rows.filter((item: Capability) => item.available !== false)
  }).catch(() => null)
})
watch(() => props.initialPrompt, value => { if (value && !prompt.value) prompt.value = value }, { immediate: true })
watch(masteryPathId, () => { if (props.mastery) { masteryTopic.value = null; openingAttempted.value = ''; void loadSessions().catch(e => { error.value = String(e) }); void loadMasteryTopic() } })
watch(readingWorkspaceId, () => { if (props.reading) void loadSessions().catch(e => { error.value = String(e) }) })
watch(() => props.noteDocumentId, () => { if (props.noteDocumentId) void loadSessions().catch(e => { error.value = String(e) }) })
onUnmounted(() => { if (attachmentErrorTimer) clearTimeout(attachmentErrorTimer); window.removeEventListener('storage', syncTrayFold); window.removeEventListener(TRAY_FOLD_EVENT, syncTrayFoldEvent); window.removeEventListener('deeptutor:voice-autoplay-global', handleVoiceAutoplayPreference); if (masteredTimer) clearTimeout(masteredTimer); askHintRequest += 1; document.removeEventListener('click', closeCapabilityMenu); document.removeEventListener('pointerdown', dismissSelection); trayRelease?.(); if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); mediaStream?.getTracks().forEach(track => track.stop()); disposed = true; clearTimers(); if (idleWatchdog) clearInterval(idleWatchdog); socket?.close(); socket = null })
watch(routeSessionId, () => {
  freshlyCompletedAssistantId.value = null
  editingMessage.value = null
  replyLanguageOverride.value = null
  languagePopupOpen.value = false
  slashDismissed.value = false
  restoreFailedSubmission()
  if (props.mastery && !routeSessionId.value) {
    const requested = String(route.params.sessionId === 'outline' || route.params.sessionId === 'review' ? route.params.sessionId : route.query.mode || 'study')
    mode.value = requested === 'outline' || requested === 'review' ? requested : 'study'
    if (!prompt.value) prompt.value = consumeMasteryOpeningPrompt()
  }
  const nextId = routeSessionId.value || null
  if (!busy.value && nextId !== activeSessionId) {
    streaming.value = ''
    streamEvents.value = []
    clearTimers()
    socket?.close()
    socket = null
    activeTurnId = null; lastSeq = 0
    activeSessionId = nextId
  }
  void loadSession().catch(e => { error.value = String(e) })
}, { immediate: true })

const hasQueuedComposerContext = computed(() => Boolean(
  pendingAttachments.value.length ||
  selectedHistorySessions.value.length ||
  selectedAgentSessions.value.length ||
  selectedMemoryFiles.value.length ||
  selectedBookReferences.value.length ||
  selectedReadingReferences.value.length ||
  selectedQuestionIds.value.length ||
  selectedNotebookRecords.value.length,
))
const resourceCounts = computed(() => ({
  history: selectedHistorySessions.value.length,
  agents: selectedAgentSessions.value.length,
  books: selectedBookReferences.value.reduce((total, book) => total + book.pages.length, 0),
  reading: countSelectedReadingUnits(selectedReadingReferences.value),
  notebooks: selectedNotebookRecords.value.length,
  questions: selectedQuestionIds.value.length,
}))

async function submit() {
  const rawContent = prompt.value.trim()
  if (props.mastery && (sessionLoading.value || sessionError.value || masteryTopicError.value)) return
  if ((!rawContent && !props.noteGeneration && !hasQueuedComposerContext.value) || busy.value) return
  if (selectedCapability.value === 'deep_research') {
    if (!researchValidation.value.valid) {
      error.value = '请先完成研究设置。'
      activityOpen.value = true
      return
    }
    if (!researchConfigConfirmed.value) {
      error.value = '请先在活动面板确认研究设置。'
      activityOpen.value = true
      return
    }
  }
  if (selectedCapability.value === 'visualize' && !visualizeConfigConfirmed.value) {
    error.value = '请先在活动面板确认可视化设置。'
    activityOpen.value = true
    return
  }
  if (pendingLanguageSave?.sessionId === routeSessionId.value) {
    try { await pendingLanguageSave.promise }
    catch { return }
  }
  const content = props.noteGeneration
    ? `${props.noteGeneration.label || props.noteGeneration.kind} · ${rawContent || '根据本页生成此学习内容'}`
    : rawContent
  shouldAutoScroll.value = true
  const outgoing = pendingAttachments.value.map(item => ({ ...item }))
  const outgoingMasteryAction = masteryAction.value
  const editingId = editingMessage.value
  const parentMessageId = submissionParentId(editingId)
  busy.value = true
  if (props.beforeSubmit && !(await props.beforeSubmit())) { busy.value = false; return }
  prompt.value = ''
  error.value = ''
  busy.value = true
  clearTimers()
  streaming.value = ''
  streamEvents.value = []
  waitingForReply.value = false
  activeTurnId = null; lastSeq = 0
  messages.value.push({ id: -Date.now(), role: 'user', content, attachments: outgoing, parentMessageId })
  activeSessionId = routeSessionId.value || null
  const submissionId = submissionIdOverride.value || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  submissionIdOverride.value = ''
  failedSubmission.value = { content, submissionId, attachments: outgoing, masteryAction: outgoingMasteryAction }
  persistFailedSubmission()
  if (socket?.readyState === WebSocket.OPEN) send(startPayload(content, submissionId, outgoing, editingId, outgoingMasteryAction, parentMessageId))
  else connect({ content, submissionId, attachments: outgoing, editingMessageId: editingId, masteryAction: outgoingMasteryAction, parentMessageId })
  pendingAttachments.value = resourceReuse.value.attachments
    ? pendingAttachments.value.filter(item => !isQuoteAttachment(item))
    : []
  masteryAction.value = null
  editingMessage.value = null
}

function newSubmissionId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function confirmResearchOutline(outline: OutlineItem[], preview: ReturnType<typeof extractResearchOutlinePreview>) {
  if (busy.value || !preview) return
  const baseConfig = preview.researchConfig ?? normalizeResearchConfig(researchConfig.value as unknown as Record<string, unknown>)
  const config = { ...baseConfig, confirmed_outline: outline }
  const command = startPayload(
    preview.topic,
    newSubmissionId(),
    [],
    null,
    null,
    null,
    { capability: 'deep_research', config, persistUserMessage: false },
  )
  shouldAutoScroll.value = true
  busy.value = true
  error.value = ''
  clearTimers()
  streaming.value = ''
  streamEvents.value = []
  waitingForReply.value = false
  activeTurnId = null
  lastSeq = 0
  activeSessionId = routeSessionId.value || null
  if (socket?.readyState === WebSocket.OPEN) send(command)
  else connect(undefined, command)
}
function attachmentHref(attachment: ChatAttachment) {
  if (attachment.url) return scopedUrl(attachment.url)
  return attachment.base64 && attachment.mime_type ? `data:${attachment.mime_type};base64,${attachment.base64}` : ''
}
function formatSize(value?: number) {
  if (!value) return ''
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`
}
function failedKey() { return `deeptutor.chat.failed:${route.fullPath}` }
function persistFailedSubmission() { if (failedSubmission.value) try { sessionStorage.setItem(failedKey(), JSON.stringify(failedSubmission.value)) } catch { /* Storage may be unavailable. */ } }
function clearFailedSubmission() { failedSubmission.value = null; try { sessionStorage.removeItem(failedKey()) } catch { /* Storage may be unavailable. */ } }
function restoreFailedSubmission() { try { failedSubmission.value = JSON.parse(sessionStorage.getItem(failedKey()) || 'null') } catch { failedSubmission.value = null } }
function retryFailedSubmission() {
  if (!failedSubmission.value) return
  prompt.value = failedSubmission.value.content
  pendingAttachments.value = failedSubmission.value.attachments.map(item => ({ ...item }))
  submissionIdOverride.value = failedSubmission.value.submissionId
  masteryAction.value = failedSubmission.value.masteryAction || null
  void submit()
}
async function loadResources() {
  const [models, personaResult, kbResult, skillResult, mcpResult, notebookResult, settings, groupResult] = await Promise.allSettled([
    api<{ active: { profile_id: string; model_id: string } | null; options: LLMOption[] }>('/api/settings/llm-options'),
    api<{ personas: ResourceOption[] }>('/api/personas'), api<ResourceOption[]>('/api/knowledge-bases/list'),
    api<{ skills: ResourceOption[] }>('/api/skills/list'), api<{ servers: Record<string, unknown> }>('/api/space/mcp/servers'),
    api<{ notebooks: ResourceOption[] }>('/api/notebooks'), api<{ ui?: { enabled_optional_tools?: string[]; response_language?: string; language?: string } }>('/api/settings'),
    api<PartnerGroupOption[]>('/api/partner-groups'),
  ])
  if (models.status === 'fulfilled') { llmOptions.value = models.value.options || []; if (!selectedModel.value && models.value.active) selectedModel.value = `${models.value.active.profile_id}:${models.value.active.model_id}` }
  if (personaResult.status === 'fulfilled') personas.value = Array.isArray(personaResult.value.personas) ? personaResult.value.personas : []
  if (kbResult.status === 'fulfilled') knowledgeBases.value = Array.isArray(kbResult.value) ? kbResult.value : []
  if (skillResult.status === 'fulfilled') skillOptions.value = Array.isArray(skillResult.value.skills) ? skillResult.value.skills : []
  if (mcpResult.status === 'fulfilled') mcpOptions.value = Object.keys(mcpResult.value.servers || {}).map(id => ({ id, name: id }))
  if (notebookResult.status === 'fulfilled') notebookOptions.value = Array.isArray(notebookResult.value.notebooks) ? notebookResult.value.notebooks : []
  if (settings.status === 'fulfilled' && settings.value.ui?.enabled_optional_tools) enabledTools.value = new Set(settings.value.ui.enabled_optional_tools)
  if (groupResult.status === 'fulfilled') partnerGroups.value = Array.isArray(groupResult.value) ? groupResult.value : Array.isArray((groupResult.value as { groups?: PartnerGroupOption[] } | undefined)?.groups) ? (groupResult.value as unknown as { groups: PartnerGroupOption[] }).groups : []
  if (settings.status === 'fulfilled') {
    const responseLanguage = settings.value.ui?.response_language || settings.value.ui?.language
    if (isResponseLanguage(responseLanguage)) accountResponseLanguage.value = responseLanguage
  }
  void api<PartnerOption[] | { partners?: PartnerOption[] }>('/api/partners').then(result => { partnerOptions.value = Array.isArray(result) ? result : Array.isArray(result.partners) ? result.partners : [] }).catch(() => { partnerOptions.value = [] })
}
function toggleSelection(selection: Set<string>, value: string) { if (selection.has(value)) selection.delete(value); else selection.add(value) }
function editMessage(message: Message) {
  if (message.role !== 'user' || message.id === undefined || busy.value) return
  editingMessage.value = message.id
}
function submitInlineEdit(message: Message, content: string) {
  const trimmed = content.trim()
  if (!trimmed || trimmed === message.content || message.id === undefined || busy.value) { editingMessage.value = null; return false }
  prompt.value = trimmed
  pendingAttachments.value = (message.attachments || []).map(item => ({ ...item }))
  editingMessage.value = message.id
  void nextTick(() => submit())
  return true
}
function showAttachmentError(message: string) {
  attachmentError.value = message
  if (attachmentErrorTimer) clearTimeout(attachmentErrorTimer)
  attachmentErrorTimer = setTimeout(() => { attachmentError.value = '' }, 4000)
}
function filterAttachmentFiles(files: File[]) {
  let runningTotal = pendingAttachments.value.reduce((sum, item) => sum + (item.size_bytes || 0), 0)
  const accepted: File[] = []
  const rejected: Array<{ file: File; reason: string }> = []
  for (const file of files) {
    if (!classifyFile(file)) { rejected.push({ file, reason: 'unsupported' }); continue }
    if (file.size > attachmentLimits.value.maxFileBytes) { rejected.push({ file, reason: 'too_large' }); continue }
    if (runningTotal + file.size > attachmentLimits.value.maxTotalBytes) { rejected.push({ file, reason: 'quota' }); break }
    runningTotal += file.size; accepted.push(file)
  }
  if (rejected.length) {
    const first = rejected[0]
    showAttachmentError(first.reason === 'too_large' ? `文件过大：${first.file.name}` : first.reason === 'quota' ? '附件总大小超出限制，已跳过部分文件' : `不支持的文件类型：${first.file.name}`)
  }
  return accepted
}
async function addAttachmentFiles(files: File[]) {
  const accepted = filterAttachmentFiles(files)
  for (const file of accepted) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768))
      const base64 = btoa(binary)
      const svg = isSvgFilename(file.name) || file.type === 'image/svg+xml'
      const isImage = !svg && file.type.startsWith('image/')
      const mimeType = file.type || 'application/octet-stream'
      pendingAttachments.value.push({ type: isImage ? 'image' : 'file', filename: file.name, base64, mime_type: mimeType, size_bytes: file.size, ...(isImage || svg ? { previewUrl: `data:${mimeType};base64,${base64}` } : {}) })
      attachmentError.value = ''
    } catch { showAttachmentError(`${file.name} 读取失败`) }
  }
}
async function attachFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  await addAttachmentFiles(files)
}
async function pasteAttachments(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => Boolean(file))
  if (!files.length) return
  event.preventDefault()
  await addAttachmentFiles(files)
}
function dragEnterAttachments(event: DragEvent) {
  event.preventDefault(); event.stopPropagation(); dragCounter += 1
  if (event.dataTransfer?.types.includes('Files')) draggingFiles.value = true
}
function dragLeaveAttachments(event: DragEvent) {
  event.preventDefault(); event.stopPropagation(); dragCounter -= 1
  if (dragCounter <= 0) { dragCounter = 0; draggingFiles.value = false }
}
function dragOverAttachments(event: DragEvent) { event.preventDefault(); event.stopPropagation() }
async function dropAttachments(event: DragEvent) {
  event.preventDefault(); event.stopPropagation(); dragCounter = 0; draggingFiles.value = false
  await addAttachmentFiles([...(event.dataTransfer?.files || [])])
}
async function toggleRecording() {
  if (recording.value) { mediaRecorder?.stop(); return }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { error.value = '当前浏览器不支持语音录制'; return }
  error.value = ''
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []
    mediaRecorder = new MediaRecorder(mediaStream)
    mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    mediaRecorder.onstop = () => {
      recording.value = false
      mediaStream?.getTracks().forEach(track => track.stop())
      mediaStream = null
      const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'audio/webm' })
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type })
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = String(reader.result || '').split(',')[1] || ''
        pendingAttachments.value.push({ type: 'audio', filename: file.name, base64, mime_type: file.type, size_bytes: file.size })
      }
      reader.readAsDataURL(file)
    }
    mediaRecorder.start()
    recording.value = true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法使用麦克风' }
}
function regenerate() {
  if (!routeSessionId.value || busy.value) return
  busy.value = true
  streaming.value = ''
  streamEvents.value = []
  activeTurnId = null
  lastSeq = 0
  const command = { type: 'regenerate', session_id: routeSessionId.value }
  if (socket?.readyState === WebSocket.OPEN) send(command)
  else connect(undefined, command)
}
async function changeMode(next: 'outline' | 'study' | 'review') {
  if (!props.mastery || next === mode.value || busy.value || modeBusy.value) return;
  modeBusy.value = true
  const id = routeSessionId.value
  try {
    if (id) {
      await api(`/api/mastery-paths/topics/${encodeURIComponent(masteryPathId.value)}/sessions/${encodeURIComponent(id)}/mode`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) })
    } else await router.replace({ path: chatBase.value, query: next === 'study' ? {} : { mode: next } })
    mode.value = next
    askHint.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '模式切换失败' } finally { modeBusy.value = false }
}
function commandId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function cancel() {
  if (activeTurnId) send({ type: 'cancel_turn', turn_id: activeTurnId, command_id: commandId() })
}
function submitUserReply(payload?: string | { text?: string; answers?: Array<{ questionId: string; text: string }> }) {
  if (!activeTurnId) return false
  const text = typeof payload === 'string' ? payload.trim() : (payload?.text || '').trim()
  const answers = typeof payload === 'object' ? payload?.answers : undefined
  if (!text && !answers?.length) return false
  send({
    type: 'submit_user_reply',
    turn_id: activeTurnId,
    ...(text ? { text } : {}),
    ...(answers?.length ? { answers } : {}),
    command_id: commandId(),
  })
  reply.value = ''
  waitingForReply.value = false
  return true
}
function submitReply() {
  if (submitUserReply(reply.value)) reply.value = ''
}
defineExpose({
  sendPrompt(value: string) {
    prompt.value = value
    void nextTick(() => submit())
  },
})
</script>

<template>
  <div class="chat-shell" :class="{ 'is-new-conversation': isNewConversation, 'is-standard-conversation': isStandardConversation, 'mastery-shell': mastery }" :data-viewer-open="activityOpen ? 'true' : 'false'">
    <aside v-if="mastery && masteryTopic" class="mastery-study-rail" :class="outlineOpen ? 'is-open' : 'is-collapsed'">
      <MasteryStudyOutline :topic="masteryTopic" :current-point-id="masteryWaypoint.id" :just-mastered-id="justMasteredId" :collapsed="!outlineOpen" @toggle="toggleMasteryOutline" />
    </aside>
    <section class="conversation">
      <header class="conversation-header"><nav v-if="!mastery && !reading && !noteDocumentId" class="chat-location" aria-label="面包屑"><span class="dt-crumb is-feature">聊天</span><span class="dt-crumb-sep">/</span><div class="chat-session-switcher"><form v-if="renamingSession" class="chat-rename-form" @submit.prevent="commitRenameSession"><input ref="renameInput" v-model="renameDraft" aria-label="对话标题" maxlength="100" @keydown.esc="cancelRenameSession" @blur="commitRenameSession"></form><button v-else class="dt-crumb is-instance" :aria-expanded="sessionSwitcherOpen" @click="sessionSwitcherOpen = !sessionSwitcherOpen">{{ displaySessionTitle }}<LegacyIcon name="chevronDown" :size="12" class="dt-crumb-caret" /></button><div v-if="sessionSwitcherOpen" class="dt-popover dt-crumb-panel is-instances" role="menu"><button class="dt-menu-item" role="menuitem" @click="router.push('/chat'); sessionSwitcherOpen = false"><LegacyIcon name="plus" :size="14" />新对话</button><div class="dt-menu-label">对话记录</div><button v-for="session in sessions" :key="session.id" class="dt-menu-item" role="menuitem" @click="router.push(`/chat/${session.id}`); sessionSwitcherOpen = false"><span class="min-w-0 flex-1 truncate">{{ session.title || '新对话' }}</span><LegacyIcon v-if="session.id === routeSessionId" name="check" :size="13" /></button></div></div></nav><nav v-else-if="mastery" class="mastery-study-location" aria-label="当前学习路径">
        <RouterLink class="mastery-study-back" :to="`/learning/mastery/${encodeURIComponent(masteryPathId)}`" title="学习路径" aria-label="学习路径"><LegacyIcon name="arrowLeft" :size="16" /></RouterLink>
        <h1>{{ masteryDisplayName }}</h1><span aria-hidden="true">/</span><strong v-if="mode === 'study'">{{ masteryWaypoint.name }}</strong>
      </nav>
      <span v-else class="conversation-title">{{ displaySessionTitle }}</span>
      <span v-if="mastery" class="mastery-mode-switch" role="group" aria-label="对话模式"><button v-for="option in (['outline','study','review'] as const)" :key="option" type="button" :class="{ active: mode === option }" :disabled="busy || modeBusy || sessionLoading || mode === option" :aria-pressed="mode === option" :title="busy || modeBusy ? '等待导师完成后再切换模式' : { outline: '设计大纲', study: '学习', review: '复习' }[option]" @click="changeMode(option)"><i aria-hidden="true" />{{ { outline: '设计大纲', study: '学习', review: '复习' }[option] }}</button></span>
      <div v-if="mastery" class="mastery-study-actions">
        <button type="button" title="保存到收藏夹" aria-label="保存到收藏夹" :disabled="!messages.length" @click="openSaveDialog"><LegacyIcon name="bookmark" :size="16" /></button>
        <button type="button" title="活动" aria-label="活动" :aria-pressed="activityOpen" @click="openActivity('activity')"><LegacyIcon name="panelLeft" :size="16" /></button>
        <span class="mastery-study-progress" :aria-label="`已掌握 ${masteryTopic?.map.counts.mastered || 0}/${masteryTopic?.map.counts.total || 0}`"><svg viewBox="0 0 18 18" aria-hidden="true"><circle class="track" cx="9" cy="9" r="8" /><circle class="value" cx="9" cy="9" r="8" :stroke-dasharray="50.265" :stroke-dashoffset="50.265 * (1 - masteryProgress)" /></svg><span>{{ masteryTopic?.map.counts.mastered || 0 }}/{{ masteryTopic?.map.counts.total || 0 }}</span></span>
      </div><div v-if="!mastery && !reading && !noteDocumentId" class="conversation-actions"><div class="conversation-action-wrap"><button class="conversation-icon-button" title="自定义页面" aria-label="自定义页面" aria-haspopup="dialog" @click.stop="customizeDialog = true; sessionMenuOpen = false"><LegacyIcon name="slidersHorizontal" :size="15" /></button></div><button class="conversation-icon-button" title="在聊天中写 Markdown" aria-label="笔记" @click="openActivity('note')"><LegacyIcon name="notebookPen" :size="16" /></button><button class="conversation-icon-button" title="会话活动、附件与预览" aria-label="活动" :aria-pressed="activityOpen" @click="openActivity('activity')"><LegacyIcon name="panelRight" :size="16" /></button><div class="conversation-action-wrap"><button class="conversation-icon-button" :title="routeSessionId ? '聊天操作' : '先开始一段对话'" :disabled="!routeSessionId" aria-label="聊天操作" :aria-expanded="sessionMenuOpen" @click.stop="toggleSessionMenu"><LegacyIcon name="more" :size="16" /></button><div v-if="sessionMenuOpen && routeSessionId" class="dt-popover conversation-menu" role="menu" aria-label="聊天操作" @click.stop>
  <button class="dt-menu-item" role="menuitem" @click="renameCurrentSession"><LegacyIcon name="edit" :size="13" />重命名</button>
  <button class="dt-menu-item" role="menuitem" @click="sessionMenuOpen = false; organizeCurrentSession({ pinned: !currentSession?.preferences?.pinned })"><LegacyIcon :name="currentSession?.preferences?.pinned ? 'pinOff' : 'pin'" :size="13" />{{ currentSession?.preferences?.pinned ? '取消置顶' : '置顶' }}</button>
  <button class="dt-menu-item" role="menuitem" @click="sessionMenuOpen = false; organizeCurrentSession({ archived: !currentSession?.preferences?.archived })"><LegacyIcon name="archive" :size="13" />{{ currentSession?.preferences?.archived ? '从归档恢复' : '归档' }}</button>
  <button v-if="currentTaskLink?.task_ids.length" class="dt-menu-item" role="menuitem" @click="sessionMenuOpen = false; toggleTaskStatusLink()"><LegacyIcon name="unlink" :size="13" />{{ currentTaskLink.status_link_enabled ? '取消任务状态关联' : '关联任务状态' }}</button>
  <template v-if="currentWorkspaceId || workspaces.some(item => item.kind === 'workspace' && !item.archived)">
    <div class="dt-menu-divider" /><div class="dt-menu-label">移动到工作区</div>
    <button class="dt-menu-item" role="menuitem" :disabled="movingWorkspace || busy || currentSession?.status === 'running'" @click="sessionMenuOpen = false; organizeCurrentSession({ workspace_id: null })"><LegacyIcon name="folderOpen" :size="13" /><span class="dt-menu-grow">通用工作区</span><LegacyIcon v-if="!currentWorkspaceId" name="check" :size="12" /></button>
    <button v-for="workspace in workspaces.filter(item => item.kind === 'workspace' && (!item.archived || item.workspace_id === currentWorkspaceId))" :key="workspace.workspace_id" class="dt-menu-item" role="menuitem" :disabled="movingWorkspace || busy || currentSession?.status === 'running' || workspace.archived || (workspace.status || 'ready') !== 'ready'" @click="sessionMenuOpen = false; organizeCurrentSession({ workspace_id: workspace.workspace_id })"><LegacyIcon name="folder" :size="13" /><span class="dt-menu-grow">{{ workspace.display_name }}</span><LegacyIcon v-if="workspace.workspace_id === currentWorkspaceId" name="check" :size="12" /></button>
  </template>
  <div class="dt-menu-divider" />
  <button class="dt-menu-item" role="menuitem" :disabled="!messages.length" @click="openSaveDialog"><LegacyIcon name="bookmarkPlus" :size="13" />保存到收藏夹</button>
  <button class="dt-menu-item" role="menuitem" :disabled="!messages.length" @click="exportCurrentSession"><LegacyIcon name="fileDown" :size="13" />下载 Markdown</button>
  <div class="dt-menu-divider" /><button class="dt-menu-item legacy-danger" role="menuitem" @click="deleteCurrentSession"><LegacyIcon name="trash" :size="13" />删除对话</button>
</div></div></div></header>
      <div class="conversation-transcript">
      <div ref="messageList" class="message-list" @scroll="handleMessageScroll(); selectedPassage = null" @wheel="releaseMessageFollow" @touchmove="releaseMessageFollow" @mousedown="selectedPassage = null" @mouseup="captureSelection" @keyup="captureSelection">
        <p v-if="mastery && masteryModeNote" class="mastery-mode-note">{{ masteryModeNote }}</p>
        <div v-if="mastery && masteryTopicLoading" class="mastery-session-loading" role="status"><span class="mastery-spinner" />正在打开学习地图…</div>
        <div v-else-if="mastery && masteryTopicError" class="mastery-session-error"><LegacyIcon name="chat" :size="28" /><h2>无法找到这张学习地图</h2><p>{{ masteryTopicError }}</p><RouterLink to="/learning/mastery">返回学习路径</RouterLink></div>
        <div v-else-if="mastery && sessionError" class="mastery-session-error"><LegacyIcon name="chat" :size="28" /><h2>会话未能打开</h2><p>{{ sessionError }}</p><RouterLink :to="`/learning/mastery/${encodeURIComponent(masteryPathId)}/sessions`">开始新会话</RouterLink></div>
        <div v-else-if="mastery && sessionLoading" class="mastery-session-loading" role="status"><span class="mastery-spinner" />正在重新打开这段会话…</div>
        <div v-else-if="mastery && messages.length === 0 && !streaming" class="mastery-empty-study">
          <span>{{ masteryEmptyCopy.eyebrow }}</span><h2>{{ masteryEmptyCopy.title }}</h2><p>{{ masteryEmptyCopy.body }}</p>
          <div class="mastery-study-starters"><button v-for="starter in masteryStarters" :key="starter.label" type="button" :disabled="busy || modeBusy || sessionLoading" @click="startMasteryPrompt(starter.label)"><LegacyIcon :name="starter.icon" :size="16" /><span>{{ starter.label }}</span></button></div>
        </div>
        <div v-else-if="messages.length === 0 && !streaming" class="empty-state">{{ isNewConversation ? welcomeGreeting : '今天想学什么？' }}</div>
        <div v-if="mastery && mode === 'outline' && messages.length && (masteryTopic?.map.counts.total || 0) > 0" class="mastery-outline-ready"><div><strong>你的大纲已准备好 · {{ masteryTopic?.map.counts.total }} 个知识点</strong><p>可以继续在这里完善大纲，或开启学习会话逐个掌握知识点。</p></div><RouterLink :to="`/learning/mastery/${encodeURIComponent(masteryPathId)}/sessions`">开始学习 <LegacyIcon name="chevronRight" :size="14" /></RouterLink></div>
        <article v-for="(row, index) in messageRows" :key="row.message.id || row.originalIndex" class="message" :class="[row.message.role, { 'is-editing': editingMessage === row.message.id }]" :data-turn-key="turnAnchorKey(row.message, row.originalIndex)" :data-chat-message-id="row.message.id" :data-chat-message-role="row.message.role">
          <template v-for="message in [row.message]" :key="index">
          <small>{{ message.role === 'user' ? '你' : 'DeepTutor' }}</small>
          <MathAnimatorViewer v-if="message.role === 'assistant' && mathAnimatorFor(message)" :result="mathAnimatorFor(message)!" />
          <VisualizationViewer v-if="message.role === 'assistant' && visualizeFor(message)" :result="visualizeFor(message)!" />
          <VideoLessonViewer v-if="message.role === 'assistant' && videoLessonFor(message)" :result="videoLessonFor(message)!" />
          <ResearchOutlineEditor
            v-if="message.role === 'assistant' && researchOutlineFor(message)"
            :outline="researchOutlineFor(message)?.subTopics || []"
            :topic="researchOutlineFor(message)?.topic || ''"
            :status="row.outlineStatus"
            @confirm="confirmResearchOutline($event, researchOutlineFor(message))"
          />
          <AskUserCard
            v-if="message.role === 'assistant' && askUserFor(message, busy && row.originalIndex === visibleMessages.length - 1)"
            :data="askUserFor(message, busy && row.originalIndex === visibleMessages.length - 1)!"
            :disabled="!waitingForReply"
            @submit="submitUserReply"
          />
          <SetupCredentialCard
            v-if="setupCredentialFor(message)"
            :data="setupCredentialFor(message)!"
          />
          <PartnerDraftCard v-if="partnerDraftFor(message)" :data="partnerDraftFor(message)!" />
          <MasteryHandoffCard v-for="handoff in masteryHandoffsFor(message)" :key="`${handoff.kind}:${handoff.path_id}:${handoff.session_id}:${handoff.module_id}`" :data="handoff" />
          <MasterySourcePresentation :events="message.events" />
          <MarkdownView
            v-if="message.role !== 'user' && !mathAnimatorFor(message)
              && !visualizeFor(message)
              && !geogebraFor(message)
              && (videoLessonFor(message)
                ? Boolean(message.content)
                : (!researchOutlineFor(message) || shouldShowResearchBody(message, row.outlineStatus)))"
            :content="message.content"
          />
          <QuizViewer
            v-if="message.role === 'assistant' && quizQuestionsFor(message)"
            :questions="quizQuestionsFor(message) || []"
            title="随堂练习"
            :session-id="routeSessionId"
            :turn-id="extractQuizTurnId(message.events)"
            :language="accountResponseLanguage"
            @submit="onQuizSubmit($event, message)"
          />
          <Geogebra
            v-if="message.role === 'assistant' && !visualizeFor(message) && geogebraFor(message)"
            :payload="geogebraFor(message)?.payload"
            :script="geogebraFor(message)?.script || ''"
            :title="geogebraFor(message)?.title || 'GeoGebra'"
          />
          <ChatUserMessageEditor v-if="message.role === 'user' && editingMessage === message.id" :content="message.content" :busy="busy" @cancel="editingMessage = null" @submit="submitInlineEdit(message, $event)" />
          <div v-else-if="message.role === 'user'" class="message-content">{{ message.content }}</div>
          <MasteryQuestionCard v-for="question in masteryQuestionsFor(message)" :key="question.questionId" :question="question" :grade="masteryGrades.get(question.questionId)" :grades="masteryGrades" :answered="answeredMasteryQuestions.has(question.questionId)" :skipped="masterySkips.has(question.questionId)" :busy="busy" @answer="answerMasteryQuestion" @skip="skipMasteryQuestion" @challenge="challengeMasteryQuestion" />
          <div v-if="message.attachments?.length" class="message-attachments">
            <template v-for="(attachment, attachmentIndex) in message.attachments" :key="attachment.id || attachmentIndex">
              <blockquote v-if="isQuoteAttachment(attachment)" class="message-quote">{{ quoteText(attachment) }}</blockquote>
              <span v-else>
                <button type="button" @click="openAttachmentViewer(attachment)">预览 {{ attachment.filename || '附件' }}</button>
                <a :href="attachmentHref(attachment)" :download="attachment.filename" :target="attachment.url ? '_blank' : undefined" rel="noopener">下载</a>
                <small v-if="attachment.size_bytes"> · {{ formatSize(attachment.size_bytes) }}</small>
              </span>
            </template>
          </div>
          <TurnActivityStream v-if="message.events?.length" :events="message.events" />
          <div class="chat-message-footer"><button v-if="message.role === 'assistant' && message.events?.length" type="button" class="chat-trace-open" @click="openTrace(message)"><LegacyIcon name="layers" :size="13" />调用追踪</button><ChatMessageActions v-if="editingMessage !== message.id" :content="message.content" :role="message.role" :sibling="messageSibling(message)" :can-edit="message.role === 'user' && typeof message.id === 'number' && message.id > 0" :can-regenerate="message.role === 'assistant' && row.originalIndex === visibleMessages.length - 1" :can-delete="canDeleteMessage(message, row.originalIndex)" :disabled="busy" :auto-play-fresh="freshlyCompletedAssistantId === message.id && row.originalIndex === visibleMessages.length - 1" :autoplay-enabled="voiceAutoplay" @edit="editMessage(message)" @regenerate="regenerate" @delete="deleteTurnForMessage(row.originalIndex)" @switch-branch="switchBranch" @failed="error = $event" /><ChatUsageFooter v-if="hasMessageUsage(message)" :turn="messageUsageFor(message)" :session="sessionUsageFor(row.originalIndex)" /></div>
          </template>
        </article>
        <article v-if="streaming" class="message assistant"><small>DeepTutor</small><MarkdownView :content="streaming" /></article>
        <AskUserCard
          v-if="liveAskUserFor()"
          :data="liveAskUserFor()!"
          :disabled="!waitingForReply"
          @submit="submitUserReply"
        />
        <SetupCredentialCard v-if="liveSetupCredential" :data="liveSetupCredential" />
        <PartnerDraftCard v-if="livePartnerDraft" :data="livePartnerDraft" />
        <MasteryHandoffCard v-for="handoff in liveMasteryHandoffs" :key="`live:${handoff.kind}:${handoff.path_id}:${handoff.session_id}:${handoff.module_id}`" :data="handoff" />
        <MasterySourcePresentation :events="streamEvents" />
        <QuizViewer
          v-if="streaming && currentStreamingQuizQuestions()"
          :questions="currentStreamingQuizQuestions() || []"
          title="随堂练习（生成中）"
          :session-id="routeSessionId"
          :turn-id="undefined"
          :language="accountResponseLanguage"
          @submit="onQuizSubmit"
        />
        <template v-if="mastery && busy"><MasteryQuestionCard v-for="question in collectMasteryQuestions(streamEvents)" :key="question.questionId" :question="question" :grade="masteryGrades.get(question.questionId)" :grades="masteryGrades" :answered="answeredMasteryQuestions.has(question.questionId)" :skipped="masterySkips.has(question.questionId)" :busy="busy" @answer="answerMasteryQuestion" @skip="skipMasteryQuestion" @challenge="challengeMasteryQuestion" /></template>
        <TurnActivityStream :events="streamEvents" />
        <TraceViewer v-if="routeSessionId && traceMessageId !== null" ref="traceViewer" :session-id="routeSessionId" :message-id="traceMessageId" :open="traceOpen" @close="closeTrace" />
        <AttachmentProcessingStream :messages="visibleMessages" :streaming="busy" />
      </div>
      <ChatTurnNavigator :entries="chatOutline" :scroll-root="messageList" @jump="shouldAutoScroll = false" @bottom="shouldAutoScroll = true" />
      <SelectionActions
        v-if="selectedPassage"
        :anchor="selectedPassage.anchor"
        :agents="connectedAgents"
        :partners="partnerOptions"
        :groups="partnerGroups"
        @add="addSelectionToChat"
        @ask="openSelectionSideChat"
        @dismiss="selectedPassage = null"
      />
      </div>
      <form class="composer" :style="composerStyle" :class="{ 'dt-note-composer': noteDocumentId, 'is-dragging-files': draggingFiles }" @submit.prevent="submit" @dragenter="dragEnterAttachments" @dragleave="dragLeaveAttachments" @dragover="dragOverAttachments" @drop="dropAttachments">
        <p v-if="connection === 'recovering'" class="notice" role="status">正在恢复对话连接…</p>
        <div v-if="waitingForReply" class="reply-form"><input v-model="reply" placeholder="回答 DeepTutor 的问题"><button type="button" class="primary" :disabled="!reply.trim()" @click="submitReply">回复</button></div>
        <div v-if="selectedReferenceItems.length" class="selected-reference-chips context-reference-wrapper">
          <ContextReferenceTree
            :items="selectedReferenceItems"
            direction="up"
            summary-noun="项引用"
            @preview="previewReferenceItem"
            @remove="removeReferenceItem"
          />
        </div>
        <div v-if="pendingQuoteAttachments.length" class="pending-quotes">
          <blockquote v-for="quote in pendingQuoteAttachments" :key="`quote-${quote.index}`">
            <span>{{ quote.text }}</span>
            <button type="button" :aria-label="`移除引用 ${quote.index + 1}`" @click="removePendingAttachment(quote.index)">×</button>
          </blockquote>
        </div>
        <div v-if="regularPendingAttachments.length" class="pending-attachments">
          <ResourceReuseToggle v-model:every-turn="resourceReuse.attachments" />
          <span v-for="row in regularPendingAttachments" :key="`${row.attachment.filename}:${row.index}`" class="pending-attachment">
            <button type="button" class="pending-attachment-preview" @click="previewAttachment = row.attachment">
              <img v-if="row.attachment.previewUrl" :src="row.attachment.previewUrl" :alt="row.attachment.filename || '附件预览'">
              <LegacyIcon v-else name="document" :size="16" />
              <span><strong>{{ row.attachment.filename }}</strong><small>{{ formatSize(row.attachment.size_bytes) }}</small></span>
            </button>
            <button type="button" class="pending-attachment-remove" :aria-label="`移除${row.attachment.filename}`" @click="removePendingAttachment(row.index)">×</button>
          </span>
        </div>
        <p v-if="attachmentError" class="error composer-attachment-error" role="alert">{{ attachmentError }}</p><div v-if="draggingFiles" class="composer-drop-overlay"><LegacyIcon name="attachment" :size="22" /><strong>将文件拖放到这里</strong><span>图片、Office 文档、代码和文本</span></div>
        <div v-if="mentionOpen && agentMentionMode" class="composer-agent-mention-menu"><div role="listbox" aria-label="与智能体对话"><div class="composer-agent-heading">与智能体对话</div><p v-if="!filteredAgents.length">{{ connectedAgents.length ? '没有匹配的智能体' : '尚未连接智能体 —— 请在「子智能体」中连接。' }}</p><div v-else class="composer-agent-options"><button v-for="agent in filteredAgents" :key="agent.name" type="button" role="option" :aria-selected="selectedAgent === agent.name" @mousedown.prevent="selectAgentMention(agent.name)"><AgentGlyph :kind="agent.kind" :size="15" /><span>{{ agent.name }}</span><LegacyIcon v-if="selectedAgent === agent.name" name="check" :size="14" /></button></div></div></div>
        <div v-if="mentionOpen && !agentMentionMode && mentionItems.length" class="composer-mention-menu" role="listbox" aria-label="引用空间"><button v-for="(item, index) in mentionItems" :key="item.key" type="button" role="option" :aria-selected="index === mentionIndex" :class="{ active: index === mentionIndex, configured: item.count > 0 }" @mousedown.prevent="selectComposerMention(item.key)" @mouseenter="mentionIndex = index"><LegacyIcon :name="item.icon" :size="15" /><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span><em v-if="item.count">{{ item.count }}</em><LegacyIcon v-if="item.key !== 'attach'" name="chevronRight" :size="14" /></button></div>
        <div v-if="!slashDismissed && slashCommands.length" class="composer-slash-menu"><div id="composer-slash-list" role="listbox" aria-label="命令"><button v-for="(command, index) in slashCommands" :id="`composer-slash-option-${index}`" :key="command" type="button" role="option" :aria-selected="index === slashIndex" :class="{ active: index === slashIndex }" @mousedown.prevent="selectComposerSlashCommand(command)" @mouseenter="slashIndex = index"><LegacyIcon :name="command === 'persona' ? 'profile' : 'language'" :size="14" /><span><strong>/{{ command }}</strong><small>{{ command === 'persona' ? '切换当前对话的人格' : '切换当前对话的回复语言' }}</small></span></button></div></div>
        <div v-if="languagePopupOpen" id="composer-language-list" class="composer-language-picker" :class="{ below: languagePickerBelow }" role="listbox" aria-label="回复语言"><div class="composer-language-heading">回复语言</div><div class="composer-language-options"><button v-for="(choice, index) in languageChoices" :id="`composer-language-option-${index}`" :key="choice.value" type="button" role="option" :aria-selected="choice.value === (replyLanguageOverride || '')" :class="{ active: index === languageIndex, selected: choice.value === (replyLanguageOverride || ''), separated: index === 1 }" @mousedown.prevent="selectReplyLanguage(choice.value)" @mouseenter="languageIndex = index"><span>{{ choice.label }}</span><LegacyIcon v-if="choice.value === (replyLanguageOverride || '')" name="check" :size="14" /></button></div></div>
        <div class="composer-input"><div v-if="!mastery && !reading && !noteDocumentId && selectedCapability !== 'chat'" ref="modeLeadElement" class="dt-composer-lead" role="group" aria-label="本条消息使用"><button type="button" class="dt-lead-token" :aria-label="`移除 模式 · ${activeCapability.label}`" @click="chooseCapability('chat')"><span class="dt-lead-icon"><ComposerGlyph :name="activeModeGlyph" :size="15" /><LegacyIcon name="x" :size="14" :stroke-width="2.2" class="dt-lead-remove" /></span><span class="dt-lead-label">{{ activeCapability.label }}</span></button></div><textarea ref="composerTextarea" v-model="prompt" :style="composerTextStyle" maxlength="32000" :aria-haspopup="languagePopupOpen || (!slashDismissed && slashCommands.length) ? 'listbox' : undefined" :aria-controls="languagePopupOpen ? 'composer-language-list' : (!slashDismissed && slashCommands.length ? 'composer-slash-list' : undefined)" :aria-activedescendant="languagePopupOpen ? `composer-language-option-${languageIndex}` : (!slashDismissed && slashCommands.length ? `composer-slash-option-${slashIndex}` : undefined)" @paste="pasteAttachments" :disabled="mastery && (sessionLoading || Boolean(sessionError) || Boolean(masteryTopicError))" :rows="1" :placeholder="mastery ? (askHint || `向导师询问“${masteryWaypoint.name}”…`) : noteDocumentId ? '就这一行提问，或告诉 Dito 要写什么…' : reading ? '就这份资料提问…' : '今天我能帮您什么？'" @keydown="handleComposerKeydown" /></div>
        <p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="error" class="error" role="alert">{{ error }}</p><div v-if="failedSubmission" class="failed-submission" role="alert">有一条尚未确认发送的消息。<button type="button" @click="retryFailedSubmission">使用同一提交 ID 重试</button><button type="button" @click="clearFailedSubmission">放弃</button></div>
        <div class="composer-actions" :class="{ 'dt-note-composer-bar': noteDocumentId }"><input ref="fileInput" class="visually-hidden" type="file" multiple :accept="ATTACHMENT_ACCEPT" :disabled="busy" @change="attachFiles"><button v-if="noteDocumentId" type="button" class="dt-note-composer-make" :aria-pressed="Boolean(noteGeneration)" @click="emit('toggleMake')"><LegacyIcon name="sparkles" :size="13" />{{ noteGeneration?.label || '生成' }}</button><div v-if="!noteDocumentId && !reading && showSettings" class="chat-mode-resources"><button ref="resourceTrigger" type="button" class="chat-mode-trigger composer-resource-trigger" aria-label="资源" :aria-expanded="resourcesOpen" @click="toggleResources"><LegacyIcon name="plus" :size="17" :stroke-width="1.7" /><span>资源</span><LegacyIcon name="chevronRight" :size="13" /></button></div><button v-else type="button" :disabled="busy" aria-label="添加附件" @click="fileInput?.click()"><LegacyIcon v-if="noteDocumentId" name="attachment" :size="14" /><LegacyIcon v-else name="plus" :size="16" /></button><span class="composer-spacer" /><ModelSelector :options="llmOptions" :value="selectedModel" @select="selectedModel = $event" /><ContextBudgetChip v-if="contextBudget" :budget="contextBudget" /><button v-if="!mastery && !reading && !noteDocumentId && customization.chat.controls.voice" type="button" class="composer-voice" :class="{ 'is-recording': recording }" :aria-label="recording ? '停止录制' : '录制语音'" @click="toggleRecording"><LegacyIcon name="mic" :size="16" :stroke-width="1.9" /></button><button v-if="busy" type="button" class="primary" @click="cancel">停止</button><button v-else class="primary" :class="{ 'dt-note-composer-send': noteDocumentId }" :disabled="!prompt.trim() && !noteGeneration && !hasQueuedComposerContext" aria-label="发送"><span v-if="noteDocumentId">↑</span><template v-else>发送</template></button></div>
      </form>
      <div v-if="!reading && !noteDocumentId" class="chat-mode-bar" :class="{ 'dt-composer-tray': true }" :data-folded="trayFolded || undefined" :data-placement="languagePickerBelow ? 'down' : 'up'" :data-dragging="trayDragging || undefined" :style="trayStyle" @pointerdown="onTrayPointerDown" @click="onTrayClick">
        <span class="dt-tray-grip-anchor"><button type="button" class="dt-tray-grip" :title="trayFolded ? '展开' : '收起'" :aria-label="trayFolded ? '展开输入工具' : '收起输入工具'" :aria-expanded="!trayFolded" aria-controls="chat-composer-tray-bar" @keydown="onTrayGripKeyDown" /></span>
        <div id="chat-composer-tray-bar" class="dt-tray-bar chat-mode-bar-row" :inert="trayFolded" :aria-hidden="trayFolded">
        <div class="chat-mode-leading"><div v-if="!mastery && !reading && !noteDocumentId" class="capability-picker"><select v-model="selectedCapability" class="legacy-capability-select" aria-label="对话能力" tabindex="-1"><option v-for="capability in capabilities" :key="capability.id" :value="capability.id">{{ capability.id }}</option></select><button type="button" class="capability-trigger" :class="{ 'has-mode': selectedCapability !== 'chat' }" aria-label="模式" :aria-expanded="capabilityMenuOpen" aria-haspopup="menu" @click="capabilityMenuOpen = !capabilityMenuOpen; moreCapabilitiesOpen = false"><LegacyIcon name="shapes" :size="14" :stroke-width="1.7" /><span v-if="selectedCapability === 'chat'">模式</span><ComposerGlyph v-else class="mode-value-icon" :name="activeModeGlyph" :size="15" /><LegacyIcon v-if="selectedCapability === 'chat'" name="chevronDown" :size="12" :stroke-width="2" /></button><div v-if="capabilityMenuOpen" class="capability-menu" :class="{ below: languagePickerBelow }" role="menu"><button v-for="capability in presentedCapabilities" :key="capability.id" type="button" class="capability-menu-item" :class="{ selected: selectedCapability === capability.id }" role="menuitem" @click="chooseCapability(capability.id)"><ComposerGlyph :name="capabilityGlyph(capability.id)" :size="15" /><span class="capability-menu-copy"><strong>{{ capability.label }}</strong><small>{{ capability.description }}</small></span><span v-if="selectedCapability === capability.id" class="capability-check">✓</span></button></div></div></div>
        <ComposerSkillsMenu v-if="customization.chat.controls.skills" v-model:selected="selectedSkills" v-model:every-turn="resourceReuse.skills" :options="skillOptions" :below="languagePickerBelow" /><ComposerConnectorsMenu v-if="customization.chat.controls.mcp" v-model:selected="selectedMcp" v-model:every-turn="resourceReuse.mcp" :options="mcpOptions" :below="languagePickerBelow" /><div class="chat-mode-trailing"><ComposerPartnerMenu v-if="customization.chat.controls.partners" v-model:partner="consultPartnerChoice" v-model:group="consultGroupChoice" v-model:agent="selectedConsultAgent" v-model:every-turn="resourceReuse.partner" :partners="partnerOptions" :groups="partnerGroups" :agents="connectedAgents" :below="languagePickerBelow" /><div v-if="customization.chat.controls.preferences" class="chat-mode-preferences"><button type="button" class="chat-mode-trigger composer-preferences-trigger" aria-label="偏好" :aria-expanded="preferencesOpen" @click="preferencesOpen = !preferencesOpen; partnerOpen = false; resourcesOpen = false"><AgentGlyph v-if="answeredAgent" :kind="answeredAgent.kind" :size="14" /><PartnerAvatar v-else-if="answeredPartner" :name="answeredPartner.name" :emoji="answeredPartner.emoji" :color="answeredPartner.color" :image="answeredPartner.avatar" :size="16" /><ComposerGlyph v-else name="plain-voice" :size="14" /><span>偏好</span><strong>{{ preferenceLabel }}</strong><LegacyIcon name="chevronDown" :size="11" /></button><AnswerPreferencesMenu :open="preferencesOpen" :below="languagePickerBelow" :persona="selectedPersona" :personas="personas" :partners="partnerOptions" :agents="connectedAgents" :answer-by="answerBy" :every-turn="resourceReuse.persona" @update:persona="selectedPersona = $event" @update:answer-by="answerBy = $event" @update:every-turn="resourceReuse.persona = $event" @close="preferencesOpen = false" :subagent-budget="subagentBudget" @update:subagent-budget="subagentBudget = $event" /></div></div>
        </div>
      </div>
      <div v-if="isStandardConversation" class="chat-existing-spacer" aria-hidden="true" />
      <StarterSuggestions v-if="showStarters && messages.length === 0 && !streaming && !mastery && !reading && !noteDocumentId" :disabled="busy" :custom-starters="customization.chat.starters" @pick="pickStarter" />
      <div v-if="showStarters && messages.length === 0 && !streaming && !mastery && !reading && !noteDocumentId" class="chat-home-spacer" aria-hidden="true"></div>
    </section>
    <button v-if="mastery && activityOpen" type="button" class="mastery-activity-backdrop" aria-label="关闭活动面板" @click="activityOpen = false" />
    <SessionViewerPanel
      ref="viewerPanel"
      v-model:note="noteContent"
      :open="activityOpen"
      :session-id="routeSessionId || 'pending'"
      :session-title="displaySessionTitle"
      :workspace-id="currentWorkspaceId"
      :task-board="taskBoard"
      :task-draft-ids="draftTaskIds"
      :agents="connectedAgents"
      :partners="partnerOptions"
      :groups="partnerGroups"
      :language="accountResponseLanguage"
      :llm-options="llmOptions"
      :initial-model="selectedModel"
      :knowledge-bases="knowledgeBases"
      :skills="skillOptions"
      :mcp="mcpOptions"
      :personas="personas"
      @update:task-board="taskBoard = $event"
      @update:task-draft-ids="draftTaskIds = $event"
      :attachments="allAttachments"
      :messages="visibleMessages"
      :stream-events="streamEvents"
      :attachment-href="attachmentHref"
      @close="activityOpen = false"
      @active-change="activityTab = $event"
    >
      <template #config>
        <CapabilityConfigCard
          v-if="!mastery && !reading && !noteDocumentId && selectedCapability === 'deep_research'"
          title="研究设置"
          icon="search"
          :confirmed="researchConfigConfirmed"
          :can-confirm="researchValidation.valid"
          :validation-errors="researchValidationMessages"
          @confirm="researchConfigConfirmed = true"
        >
          <ResearchConfigPanel :model-value="researchConfig" @update:model-value="updateResearchConfig" />
        </CapabilityConfigCard>
        <CapabilityConfigCard
          v-if="!mastery && !reading && !noteDocumentId && selectedCapability === 'visualize'"
          title="可视化设置"
          icon="resources"
          :confirmed="visualizeConfigConfirmed"
          @confirm="visualizeConfigConfirmed = true"
        >
          <VisualizeConfigPanel :model-value="visualizeConfig" @update:model-value="updateVisualizeConfig" />
        </CapabilityConfigCard>
      </template>
    </SessionViewerPanel>
  </div>
  <MasteryLevelUpCelebration v-if="mastery && masteryCelebration" :key="masteryCelebrationKey" @done="masteryCelebration = false" />
  <ComposerResourcesPanel v-if="resourcesOpen && showSettings && !reading && !noteDocumentId" v-model:draft-task-ids="draftTaskIds" v-model:selected-kbs="selectedKbs" :session-id="routeSessionId" :workspace-id="currentWorkspaceId" :anchor-left="resourceAnchor.left" :anchor-bottom="resourceAnchor.bottom" :knowledge-bases="knowledgeBases" :counts="resourceCounts" @close="closeResources" @attach="fileInput?.click()" @history="historyPickerOpen = true" @agents="agentsPickerOpen = true" @books="bookPickerOpen = true" @reading="readingPickerOpen = true" @notebooks="notebookPickerOpen = true" @questions="questionPickerOpen = true" />
  <MyAgentsPicker v-model:every-turn="resourceReuse.agents" :open="agentsPickerOpen" :initial="selectedAgentSessions" @close="agentsPickerOpen = false" @apply="selectedAgentSessions = $event" />
  <PersonaPicker v-model:every-turn="resourceReuse.persona" :open="personaPickerOpen" :initial="selectedPersona" @close="personaPickerOpen = false" @apply="selectedPersona = $event" />
  <NotebookRecordPicker v-model:every-turn="resourceReuse.notebooks" :open="notebookPickerOpen" :initial="selectedNotebookRecords" @close="notebookPickerOpen = false" @apply="selectedNotebookRecords = $event" />
  <QuestionBankPicker v-model:every-turn="resourceReuse.questions" :open="questionPickerOpen" :initial="selectedQuestionIds" @close="questionPickerOpen = false" @apply="selectedQuestionIds = $event" />
  <BookReferencePicker v-model:every-turn="resourceReuse.books" :open="bookPickerOpen" :initial="selectedBookReferences" @close="bookPickerOpen = false" @apply="selectedBookReferences = $event" />
  <ReadingReferencePicker v-model:every-turn="resourceReuse.reading" :open="readingPickerOpen" :initial="selectedReadingReferences" @close="readingPickerOpen = false" @apply="selectedReadingReferences = $event" />
  <MemoryPicker v-model:every-turn="resourceReuse.memory" :open="memoryPickerOpen" :initial="selectedMemoryFiles" @close="memoryPickerOpen = false" @apply="selectedMemoryFiles = $event" />
  <HistorySessionPicker v-model:every-turn="resourceReuse.history" :open="historyPickerOpen" :initial="selectedHistorySessions" @close="historyPickerOpen = false" @apply="selectedHistorySessions = $event" />
  <ConversationSaveDialog v-if="saveDialogOpen" :messages="visibleMessages" :session-id="routeSessionId" :capability="mastery ? 'mastery_path' : selectedCapability" @close="saveDialogOpen = false" @saved="saveDialogOpen = false; notice = '已保存到收藏夹'" />
  <ChatCustomizeDialog v-if="customizeDialog" :capabilities="allPresentedCapabilities" @close="customizeDialog = false" @saved="customization = $event; customizeDialog = false" />
  <section v-if="previewAttachment" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="附件预览" @click="previewAttachment = null"><div class="modal-panel" @click.stop><header class="modal-header"><h2>{{ previewAttachment.filename || '附件' }}</h2><button @click="previewAttachment = null">关闭</button></header><img v-if="previewAttachment.mime_type?.startsWith('image/') && attachmentHref(previewAttachment)" :src="attachmentHref(previewAttachment)" :alt="previewAttachment.filename || '附件'"><pre v-else-if="previewAttachment.extracted_text">{{ previewAttachment.extracted_text }}</pre><p v-else>此文件暂不支持内嵌预览，请下载后查看。</p><a :href="attachmentHref(previewAttachment)" :download="previewAttachment.filename">下载附件</a></div></section>
</template>
