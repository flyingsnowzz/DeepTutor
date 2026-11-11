<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownView from './MarkdownView.vue'
import PartnerAvatar from './PartnerAvatar.vue'
import LegacyIcon from './LegacyIcon.vue'
import type {
  GroupInvocation,
  GroupMember,
  GroupSeat,
} from '../groupDiscussion'

const props = defineProps<{
  seat: GroupSeat
  member?: GroupMember
  peers: GroupMember[]
  pendingInvocation: boolean
}>()
const emit = defineEmits<{
  trace: []
  quote: [payload: { member?: GroupMember; content: string }]
  'ask-peer': [targetId: string]
  approve: [invocationId: string]
  reject: [invocationId: string]
}>()

const copied = ref(false)
const askOpen = ref(false)
const working = computed(() => ['waiting', 'working'].includes(props.seat.status))
const body = computed(() => props.seat.message?.content ?? props.seat.streamed)
const name = computed(() => props.seat.message?.author_name || props.member?.name || props.seat.partnerId)
const isQuestion = computed(() => props.seat.message?.kind === 'invocation_question')
const kindLabel = computed(() => {
  if (isQuestion.value) return ''
  if (props.seat.message?.kind === 'debate_rebuttal') return '反驳'
  if (props.seat.message?.kind === 'round_summary') return '总结'
  return ''
})
const invocation = computed<GroupInvocation | null>(() => props.seat.message?.invocation || null)
const canAskPeer = computed(() =>
  props.seat.status === 'done'
  && !['invocation_question', 'round_summary'].includes(props.seat.message?.kind || ''))
const availablePeers = computed(() =>
  props.peers.filter(peer => peer.partner_id !== props.seat.partnerId))

async function copy() {
  if (!body.value) return
  try {
    await navigator.clipboard.writeText(body.value)
    copied.value = true
    window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    /* Clipboard denial leaves the transcript untouched. */
  }
}

function questionNeedsEcho(value: GroupInvocation) {
  return value.status === 'pending' || value.status === 'rejected' || value.status === 'failed'
}
</script>

<template>
  <div class="group-seat" :data-seat="seat.partnerId" :data-seat-status="seat.status">
    <PartnerAvatar :name="name" :emoji="member?.emoji" :color="member?.color" :image="member?.avatar" :size="28" />
    <div class="group-seat-main">
      <div class="group-seat-head">
        <strong>{{ name }}</strong>
        <span v-if="kindLabel" class="group-seat-kind">{{ kindLabel }}</span>
        <span v-if="working" class="group-seat-status"><LegacyIcon name="loaderCircle" :size="10" />{{ seat.status === 'waiting' ? '等待中…' : '思考中…' }}</span>
        <button v-if="seat.events.length" type="button" class="group-seat-trace" @click="emit('trace')"><LegacyIcon name="activity" :size="10" />推理步骤</button>
      </div>
      <p v-if="seat.status === 'error'" class="group-seat-error">{{ body || '这位伙伴未能作答。' }}</p>
      <div v-else-if="body" class="group-seat-body" :class="{ 'is-question': isQuestion, 'is-streaming': working }">
        <MarkdownView :content="body" />
      </div>
      <div v-if="!working && body" class="group-seat-actions">
        <button type="button" @click="copy"><LegacyIcon :name="copied ? 'check' : 'copy'" :size="11" />{{ copied ? '已复制' : '复制' }}</button>
        <button v-if="!isQuestion" type="button" @click="emit('quote', { member, content: body })"><LegacyIcon name="cornerUpRight" :size="11" />继续追问</button>
        <div v-if="canAskPeer && availablePeers.length" class="group-peer-menu">
          <button type="button" @click="askOpen = !askOpen"><LegacyIcon name="partners" :size="11" />询问其他伙伴</button>
          <div v-if="askOpen" class="group-peer-popover" @mouseleave="askOpen = false">
            <small>谁应该回应 {{ name }}？</small>
            <button v-for="peer in availablePeers" :key="peer.partner_id" type="button" @click="askOpen = false; emit('ask-peer', peer.partner_id)">
              <PartnerAvatar :name="peer.name" :emoji="peer.emoji" :color="peer.color" :image="peer.avatar" :size="18" />
              <span>{{ peer.name }}</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="invocation && invocation.status !== 'completed'" class="group-invocation-card">
        <div class="group-invocation-route">
          <span>{{ invocation.requester_partner_name }}</span>
          <LegacyIcon name="arrowRight" :size="11" />
          <span>{{ invocation.target_partner_name }}</span>
        </div>
        <p v-if="questionNeedsEcho(invocation)">{{ invocation.question }}</p>
        <div v-if="invocation.status === 'pending'" class="group-invocation-actions">
          <button type="button" class="primary" :disabled="pendingInvocation" @click="emit('approve', invocation.invocation_id)">
            <LegacyIcon :name="pendingInvocation ? 'loaderCircle' : 'check'" :size="11" />让他们讨论
          </button>
          <button type="button" :disabled="pendingInvocation" @click="emit('reject', invocation.invocation_id)">暂不</button>
        </div>
        <div v-else class="group-invocation-state">
          <template v-if="invocation.status === 'approved'"><LegacyIcon name="loaderCircle" :size="11" />等待 {{ invocation.target_partner_name }}</template>
          <template v-else-if="invocation.status === 'rejected'"><LegacyIcon name="close" :size="11" />已拒绝</template>
          <template v-else-if="invocation.status === 'failed'"><span>{{ invocation.error || '追问失败' }}</span></template>
        </div>
      </div>
    </div>
  </div>
</template>
